# 腾讯会议连接器 API

> 状态：契约已冻结，服务端尚未实现。公开契约版本：`0.37.0`。

完整定义以 `packages/contracts/openapi/openapi.yaml` 为准。当前契约只定义个人 OAuth 授权、连接状态、解绑、只读工具发现和只读工具执行，不包含创建、修改或取消会议等写操作。

## 1. 资源归属

腾讯会议授权属于当前 CEES 租户成员，服务端必须同时绑定：

- `tenantId`：当前请求所属 CEES 租户；
- `membershipId`：当前登录用户在该租户中的成员身份。

同一自然人在不同 CEES 租户中的授权相互隔离。一个成员的腾讯会议 Token 不得供同租户其他成员或平台管理员直接复用。

除 OAuth 回调外，全部接口使用租户 Access Token。OAuth 回调不依赖浏览器中的 CEES Token，只依据服务端创建并一次性消费的 State 定位授权发起人。

## 2. 接口

| 方法 | 路径 | operationId | 用途 |
| --- | --- | --- | --- |
| `POST` | `/connectors/tencent-meeting/authorization` | `startTencentMeetingAuthorization` | 创建一次性 State 并返回授权地址 |
| `GET` | `/connectors/tencent-meeting/oauth/callback` | `completeTencentMeetingAuthorization` | 接收腾讯会议 OAuth 浏览器回调 |
| `GET` | `/connectors/tencent-meeting/status` | `getTencentMeetingConnectionStatus` | 查询当前成员授权和 Token 健康状态 |
| `DELETE` | `/connectors/tencent-meeting/authorization` | `disconnectTencentMeeting` | 幂等解绑当前成员授权 |
| `GET` | `/connectors/tencent-meeting/tools` | `listTencentMeetingConnectorTools` | 查询当前 Scope 可用的只读工具 |
| `POST` | `/connectors/tencent-meeting/executions` | `executeTencentMeetingConnectorTools` | 顺序执行一至三条只读工具调用 |

路径均基于 `/api/v1`。

## 3. 发起授权

`POST /connectors/tencent-meeting/authorization` 不接收调用方提供的回调地址、State、Scope、Client ID 或 Secret。以上参数由服务端固定配置和生成，防止开放重定向、State 注入和授权范围提升。

响应 `TencentMeetingAuthorization`：

```json
{
  "authorizationUrl": "https://meeting.tencent.com/oauth2/authorize?...",
  "expiresAt": "2026-09-22T10:10:00.000Z",
  "pollAfterMs": 1500
}
```

- `authorizationUrl` 已包含一次性 State；响应不单独返回原始 State；
- `expiresAt` 是本次授权尝试的过期时间；
- Desktop 打开系统浏览器后，按 `pollAfterMs` 轮询状态；
- 同一成员重复发起授权时，服务端使此前未完成的授权尝试失效；
- 已连接且未要求重新授权时返回 `409`，错误码使用 `CONNECTOR_ALREADY_CONNECTED`（服务端实现阶段加入统一错误目录）。

## 4. OAuth 回调

`GET /connectors/tencent-meeting/oauth/callback` 是公开浏览器回调：

- `state` 必填；
- 授权成功时 `code` 必填；
- 用户拒绝授权时可返回 `error` 和 `error_description`；
- `code` 与 `error` 至少存在一个；
- State 必须短期有效、绑定租户成员、只能消费一次；
- Token 交换和账号查询完成后返回简单 HTML，引导用户回到 CEES Desktop；
- 回调页面和日志不得输出授权码、Access Token、Refresh Token 或应用 Secret。

回调失败返回 HTML 而不是 JSON Envelope，因为该接口由系统浏览器直接访问。业务客户端通过状态接口获取结构化结果。

## 5. 连接状态

`TencentMeetingConnection` 不返回第三方 Token，只返回：

- `state`：`NOT_CONNECTED/AUTHORIZING/READY/ERROR`；
- `authenticated`：授权有效且 Token 可用时为 `true`；
- `account`：腾讯会议外部用户和组织摘要；
- `grantedScopes`：提供方实际授予的 Scope；
- `tokenStatus`：`MISSING/VALID/EXPIRING/REFRESH_FAILED/REVOKED`；
- 授权、过期、最近验证时间；
- 受控错误码和用户可读错误说明。

`CONNECTOR_NOT_CONFIGURED` 等配置问题通过 `state=ERROR` 返回，使 Desktop 能稳定展示状态；发起授权或执行工具时仍返回对应 HTTP 错误。

## 6. 只读工具

契约冻结五个工具 ID：

| toolId | 用途 |
| --- | --- |
| `tencent_meeting.profile.get` | 查询当前授权账号资料 |
| `tencent_meeting.meetings.list` | 查询当前账号可访问的会议列表 |
| `tencent_meeting.meetings.get` | 查询指定会议详情 |
| `tencent_meeting.participants.list` | 查询指定会议参会成员 |
| `tencent_meeting.recordings.list` | 查询指定会议录制和纪要元数据 |

`GET /tools` 根据实际 Scope 返回上述工具的子集。工具参数以服务端返回的 JSON Schema 为准，但 `POST /executions` 仍必须再次执行服务端 Schema 校验，不能信任 Desktop 或模型提交的参数。

执行请求最多包含三条调用：

```json
{
  "calls": [
    {
      "toolId": "tencent_meeting.meetings.get",
      "arguments": { "meetingId": "meeting-id" }
    }
  ]
}
```

响应按请求顺序返回 `TencentMeetingConnectorContext[]`。`data` 必须经过字段白名单、敏感信息脱敏和大小限制，不得包含 Token、Secret、Cookie、Authorization Header 或提供方原始认证响应。

## 7. 失败语义

服务端实现必须使用统一 `ErrorResponseEnvelope`，稳定错误码包括：

| 错误码 | 典型 HTTP 状态 | 含义 |
| --- | --- | --- |
| `CONNECTOR_NOT_CONFIGURED` | `503` | 服务端缺少腾讯会议应用配置 |
| `CONNECTOR_ALREADY_CONNECTED` | `409` | 当前成员已经完成授权，需先解绑再重新授权 |
| `OAUTH_STATE_INVALID` | `400` | State 不存在或签名不合法 |
| `OAUTH_STATE_EXPIRED` | `400` | State 已过期 |
| `OAUTH_STATE_ALREADY_USED` | `400` | State 已被消费 |
| `OAUTH_ACCESS_DENIED` | `400` | 用户或腾讯会议拒绝本次授权 |
| `AUTH_REQUIRED` | `409` | 当前成员尚未授权或授权已撤销 |
| `INSUFFICIENT_SCOPE` | `403` | 腾讯会议授权 Scope 不足 |
| `TOKEN_REFRESH_FAILED` | `409` | Token 刷新失败，需要重新授权 |
| `PROVIDER_RATE_LIMITED` | `429` | 腾讯会议提供方限流 |
| `PROVIDER_UNAVAILABLE` | `502/503` | 腾讯会议响应无效或暂不可用 |
| `RESOURCE_FORBIDDEN` | `403` | 当前腾讯会议账号无权访问目标资源 |
| `INVALID_ARGUMENTS` | `400` | 工具参数不符合固定 Schema |

错误响应不得向客户端泄露上游请求签名、应用 Secret、Token、完整提供方响应或内部网络地址。

## 8. 后续实现要求

- 契约实现前先增加 Prisma migration，保存成员级连接、OAuth State 和加密 Token；
- Secret 只来自服务端环境变量或平台 Secret；
- Token 使用服务端密钥加密，Refresh Token 更新必须具备并发控制；
- 授权、回调、刷新、执行和解绑均记录租户、成员、连接器、请求和结果审计事件；
- Desktop 只能调用 CEES API，不能直接持有腾讯会议应用 Secret 或 Token；
- 写操作不在 `0.37.0` 范围内，后续必须单独提升契约版本并增加二次确认设计。

产品与运行时设计见 [腾讯会议连接器](../product/tencent-meeting-connector.md) 和 [Desktop 连接器运行时](../architecture/connector-runtime.md)。
