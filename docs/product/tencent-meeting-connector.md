# 腾讯会议连接器

## 1. 当前状态

- 已落地：腾讯会议 `ConnectorManifest`、通用 Adapter、Registry 注册和连接器市场动态展示。
- 已落地：当前用户、会议列表、会议详情、参会成员、录制与纪要元数据五类只读工具 Schema。
- 已落地：通用 `HttpApiTransport`，提供固定服务地址、路径白名单、超时、响应大小限制、JSON 解析和结构化错误。
- 已落地：Desktop 连接器卡片调用 CEES API 发起 OAuth、通过系统浏览器完成授权、轮询成员级连接状态，并支持解绑和重新授权。
- 已落地：公开契约 `0.37.1`，定义成员级 OAuth 授权、回调、状态、解绑、工具发现和批量只读执行，并将官方回调字段修正为 `auth_code`。
- 已落地：`apps/api` 中的 OAuth State、授权回调、Token 加密托管、刷新租约、解绑和审计。
- 已落地：腾讯会议五类只读 API 网关、Scope 工具过滤、严格参数校验、字段白名单、分页适配、响应大小限制和执行审计。
- 已落地：Assistant Tool Loop 通过 CEES API 直接调用只读网关；Desktop 不建设会议列表或详情业务页面。

当前 API 已具备真实 OAuth 和只读查询能力，Desktop 市场卡片已完成授权、状态和解绑闭环。用户可直接在 Assistant 会话中查询自己的腾讯会议账号、会议、参会成员和录制元数据；查询全部由 API 后端执行，不在 Desktop 建设独立会议客户端。

## 2. 目标

腾讯会议连接器采用 API 执行型架构，验证 CEES 连接器运行时不仅支持钉钉 DWS 本地 CLI，也可以承载必须由服务端保存密钥和 Token 的第三方 HTTP API：

```text
Desktop Connector Marketplace
    -> ConnectorHost
        -> TencentMeetingConnectorAdapter
            -> CEES API Connector Gateway（已实现）
                -> Tencent Meeting OAuth / Open API
```

连接器只向 AI 暴露经过 CEES 定义和校验的只读工具。模型不能提交任意 URL、HTTP Header、Access Token 或腾讯会议原始 API 路径。

## 3. 安全边界

腾讯会议 OAuth 应用 Secret、Access Token 和 Refresh Token 不得打包进 Desktop，也不得保存到 Renderer 的 Local Storage。腾讯会议官方 OAuth 说明要求应用 Secret 和 Access Token 保存在服务端，参考：[腾讯会议 OAuth 2.0 授权](https://cloud.tencent.com/document/product/1095/51257)。

服务端当前满足：

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

当前 Desktop 生命周期行为：

- `status` 从 CEES API 获取当前租户成员的授权和 Token 健康状态；
- `connect` 从 CEES API 获取一次性授权地址，通过受控 Electron IPC 打开 HTTPS 系统浏览器，并轮询至成功、失败或 State 超时；
- `disconnect` 删除 CEES API 为当前租户成员保存的腾讯会议凭据；
- Desktop 不保存腾讯会议 Access Token、Refresh Token 或应用 Secret；
- Desktop 既有工具执行占位不用于正式会话；Assistant Tool Loop 在 API 内部按当前租户成员身份直接调用只读网关。

## 5. 第一阶段只读工具

| 工具 ID | 用途 | 关键参数 |
| --- | --- | --- |
| `tencent_meeting.profile.get` | 查询当前已授权账号资料 | 无 |
| `tencent_meeting.meetings.list` | 按时间范围查询会议列表 | `startTime/endTime/page/pageSize` |
| `tencent_meeting.meetings.get` | 查询会议详情 | `meetingId` |
| `tencent_meeting.participants.list` | 查询参会成员 | `meetingId/page/pageSize` |
| `tencent_meeting.recordings.list` | 查询录制和纪要元数据 | `meetingId` |

所有工具参数 Schema 均设置 `additionalProperties=false`。服务端执行层再次校验时间范围、分页上限、会议 ID、调用数量和腾讯会议授权 Scope；历史空 Scope 记录保持兼容，由提供方继续执行资源权限校验。

Assistant 对模型暴露以下稳定函数名，避免把提供方内部带点号的工具 ID 直接作为函数名：

| Assistant 工具 | 网关工具 ID | 风险等级 |
| --- | --- | --- |
| `tencent_meeting_get_profile` | `tencent_meeting.profile.get` | `READ` |
| `tencent_meeting_list_meetings` | `tencent_meeting.meetings.list` | `READ` |
| `tencent_meeting_get_meeting` | `tencent_meeting.meetings.get` | `READ` |
| `tencent_meeting_list_participants` | `tencent_meeting.participants.list` | `READ` |
| `tencent_meeting_list_recordings` | `tencent_meeting.recordings.list` | `READ` |

这些工具不要求 CEES 业务权限码，因为它们只读取当前成员本人通过 OAuth 授权后可见的第三方资源；TurnRunner 仍会校验当前租户成员有效性，腾讯会议网关继续校验成员级凭据、Scope 和提供方资源权限。工具不支持创建、修改、取消会议或下载录制文件。

会议列表支持 `TODAY`、`TOMORROW`、`THIS_WEEK`、`NEXT_7_DAYS` 以及明确的 ISO 8601 时间范围。相对日期以租户配置的 IANA 时区计算，其中 `THIS_WEEK` 定义为租户本地时间周一 00:00 至下周一 00:00。工具摘要保留 `meeting_id` 供多轮对话继续查询详情、参会成员或录制，但明确要求模型不得在普通回答中主动展示内部 ID。

授权失效、Scope 不足、资源无权访问、限流和提供方不可用等错误会转换为固定用户文案后再回喂模型；腾讯会议原始响应、Token、手机号、邮箱、IP、下载地址和提供方技术错误不会进入模型上下文。

执行结果仅保留会议、参会者和录制的业务摘要字段。参会者标识使用会议 ID 与提供方用户标识生成 SHA-256 稳定键，不返回手机号、邮箱、IP、设备标识或原始用户 ID；录制结果不返回播放或下载 URL。

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

1. 已完成：契约定义授权开始、状态、解绑和五类只读查询接口及失败语义。
2. 已完成：API 实现 OAuth State、回调、Token 加密托管、刷新租约、解绑和审计。
3. 已完成：将五类工具映射到固定腾讯会议 Open API，不接受任意 URL，并补齐字段过滤、分页适配、大小限制和审计。
4. 已完成：Desktop 市场卡片接入 CEES API 授权、状态、轮询和解绑，授权时通过系统浏览器打开服务端返回的地址。
5. 已完成：Assistant 接入原生 Tool Loop，由 API 按当前租户成员身份直接执行五类腾讯会议只读工具。
6. 写操作：另行设计创建会议、修改会议等操作的权限和二次确认机制。

## 8. 验证

- Electron TypeScript 检查；
- `HttpApiTransport` 固定域名、路径白名单、错误、超时和响应大小测试；
- 腾讯会议 Manifest、工具目录、未授权失败语义和 Adapter 委托测试；
- Desktop 生产构建和连接器市场双卡片展示检查。
- API 腾讯会议局部 Jest、NestJS 构建、契约 lint 与生成客户端 TypeScript 检查。
