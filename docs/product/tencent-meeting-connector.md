# 腾讯会议连接器

## 1. 当前状态

- 已落地：腾讯会议 `ConnectorManifest`、通用 Adapter、Registry 注册和连接器市场动态展示。
- 已落地：当前用户、会议列表、会议详情、参会成员、录制与纪要元数据五类只读工具 Schema。
- 已落地：通用 `HttpApiTransport`，提供固定服务地址、路径白名单、超时、响应大小限制、JSON 解析和结构化错误。
- 已落地：在服务端 OAuth 尚未接入时返回明确的 `SERVER_OAUTH_REQUIRED` 状态，不伪造授权成功或会议查询结果。
- 待实现：`packages/contracts` 中的腾讯会议授权与只读查询契约。
- 待实现：`apps/api` 中的 OAuth State、授权回调、Token 加密托管、刷新、解绑、审计和腾讯会议 API 网关。
- 待实现：Desktop 通过 CEES API 完成真实授权、状态查询和只读工具执行。

当前阶段是连接器基础能力，不代表腾讯会议账号已经可以完成真实授权或查询。市场卡片会展示连接器及待授权状态，并明确提示必须先接入 CEES API 服务端 OAuth。

## 2. 目标

腾讯会议连接器采用 API 执行型架构，验证 CEES 连接器运行时不仅支持钉钉 DWS 本地 CLI，也可以承载必须由服务端保存密钥和 Token 的第三方 HTTP API：

```text
Desktop Connector Marketplace
    -> ConnectorHost
        -> TencentMeetingConnectorAdapter
            -> CEES API Connector Gateway（待实现）
                -> Tencent Meeting OAuth / Open API
```

连接器只向 AI 暴露经过 CEES 定义和校验的只读工具。模型不能提交任意 URL、HTTP Header、Access Token 或腾讯会议原始 API 路径。

## 3. 安全边界

腾讯会议 OAuth 应用 Secret、Access Token 和 Refresh Token 不得打包进 Desktop，也不得保存到 Renderer 的 Local Storage。腾讯会议官方 OAuth 说明要求应用 Secret 和 Access Token 保存在服务端，参考：[腾讯会议 OAuth 2.0 授权](https://cloud.tencent.com/document/product/1095/51257)。

后续服务端实现必须满足：

- OAuth State 与 CEES 用户、租户、客户端会话绑定，并设置短过期时间和一次性消费语义；
- 应用 Secret 只来自服务端环境变量或平台 Secret；
- 第三方 Token 采用服务端加密存储，不通过公开 API 返回给 Desktop；
- Token 刷新加锁或使用等价的并发控制，避免重复刷新导致凭据失效；
- 解绑撤销或清除服务端 Token，并记录租户、操作者、连接器和请求审计信息；
- 腾讯会议 API 响应进入 AI 前执行字段过滤、大小限制和敏感字段脱敏；
- 后续写操作必须单独建模风险等级，并增加显式二次确认，不得复用只读执行入口静默写入。

## 4. Manifest 与生命周期

腾讯会议 Manifest 当前声明：

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `id` | `tencent-meeting` | 稳定连接器 ID |
| `transportType` | `HTTP_API` | 最终通过受控 HTTP API 网关执行 |
| `executionLocation` | `API` | 第三方 Secret 与 Token 只能存在服务端 |
| `authType` | `OAUTH` | 使用腾讯会议 OAuth 授权 |
| `supportsInstall` | `false` | 不需要安装本地组件 |
| `supportsDisconnect` | `true` | 后续支持解绑和清除授权 |
| `supportsDynamicTools` | `true` | 工具能力可根据授权范围和服务状态发现 |

当前默认生命周期行为：

- `status/connect/disconnect` 返回 `AUTH_REQUIRED`；
- `issueCode` 固定为 `SERVER_OAUTH_REQUIRED`；
- 工具目录可以被发现，用于验证 Schema 和后续 Tool Loop 接线；
- 工具执行会明确失败，不返回模拟业务数据。

## 5. 第一阶段只读工具

| 工具 ID | 用途 | 关键参数 |
| --- | --- | --- |
| `tencent_meeting.profile.get` | 查询当前已授权账号资料 | 无 |
| `tencent_meeting.meetings.list` | 按时间范围查询会议列表 | `startTime/endTime/page/pageSize` |
| `tencent_meeting.meetings.get` | 查询会议详情 | `meetingId` |
| `tencent_meeting.participants.list` | 查询参会成员 | `meetingId/page/pageSize` |
| `tencent_meeting.recordings.list` | 查询录制和纪要元数据 | `meetingId` |

所有工具参数 Schema 均设置 `additionalProperties=false`。后续服务端执行层还必须校验时间范围、分页上限、会议访问权限和腾讯会议授权 Scope。

## 6. HttpApiTransport

通用 `HttpApiTransport` 为后续 API 型连接器提供：

- 固定 `baseUrl`，拒绝请求中传入外部完整 URL；
- 路径前缀白名单，防止 Adapter 越界调用其他服务接口；
- Header 由可信依赖提供，禁止覆盖 `Host` 和 `Content-Length`；
- 仅使用 JSON 请求和响应；
- 最大 120 秒超时与可配置响应字节上限；
- 禁止自动跟随重定向；
- 统一 `HttpApiError`，保留 HTTP 状态、是否超时、是否可重试和受限响应正文。

本阶段 Transport 没有直接配置腾讯会议域名和凭据，也没有从环境变量读取腾讯会议 Secret。后续由腾讯会议服务端网关完成第三方请求，Desktop Transport 只允许调用受信任的 CEES API 路径。

## 7. 后续实施顺序

1. 契约：定义授权开始、状态、解绑和五类只读查询接口及失败语义。
2. API：实现 OAuth State、回调、Token 加密托管、刷新和审计。
3. 网关：将五类工具映射到固定腾讯会议 Open API，不接受任意 URL。
4. Desktop：将默认 Adapter 依赖替换为 CEES API 网关调用，授权时打开服务端返回的授权地址。
5. Assistant：授权与查询稳定后，再接入原生 Tool Loop。
6. 写操作：另行设计创建会议、修改会议等操作的权限和二次确认机制。

## 8. 验证

- Electron TypeScript 检查；
- `HttpApiTransport` 固定域名、路径白名单、错误、超时和响应大小测试；
- 腾讯会议 Manifest、工具目录、未授权失败语义和 Adapter 委托测试；
- Desktop 生产构建和连接器市场双卡片展示检查。
