# Desktop 连接器运行时

## 1. 当前状态

- 已落地通用 `ConnectorManifest`、`ConnectorStatus`、`ConnectorTool`、`ConnectorPlannedCall`、`ConnectorContext`；
- 已落地 `ConnectorAdapter`、`ConnectorRegistry`、`ConnectorHost` 和通用 Electron IPC/Preload 生命周期；
- 已落地 `LocalCliTransport`，钉钉 DWS 作为 Desktop 本地 CLI 连接器运行；
- 已落地 `HttpApiTransport`，供固定 API 地址和路径白名单型连接器复用；
- 已落地 `RemoteMcpTransport`，提供固定 HTTPS 地址、JSON-RPC、动态安全请求头、超时、响应上限、禁止重定向和结构化错误；
- 已落地腾讯会议官方远程 MCP 接入，个人 Token 仅保存在 Desktop `safeStorage`；
- 已落地腾讯会议动态工具发现、API 无副作用规划、Desktop 执行和写操作二次确认；
- 已删除腾讯会议旧服务端 OAuth、Token 托管、固定工具网关和数据表。

## 2. 目标

连接器运行时为钉钉、企业微信、腾讯会议及后续外部系统提供统一生命周期和执行边界。统一的是连接状态、能力发现、结构化调用、错误处理和安全策略，不强制所有厂商使用同一种协议或凭据位置。

```text
Assistant UI
    -> ConnectorHost
        -> ConnectorAdapter
            -> Local CLI / Local MCP / Remote MCP / HTTP API / SDK / WebSocket
                -> External Official Service
```

## 3. 运行时组件

```text
ConnectorManifest
ConnectorStatus
ConnectorTool
ConnectorPlannedCall
ConnectorContext
ConnectorAdapter
ConnectorRegistry
ConnectorHost
LocalCliTransport
HttpApiTransport
RemoteMcpTransport
```

通用 IPC 包括 `list/status/connect/disconnect/tools/execute` 和统一状态事件。提供方特有能力可保留扩展 IPC，例如钉钉 Profile、DWS 安装、升级和回滚，不能为了统一接口而丢失真实能力。

## 4. 当前连接器路径

### 钉钉

```text
Renderer -> ConnectorHost -> DingTalkConnectorAdapter
    -> LocalCliTransport -> Managed DWS -> DingTalk
```

钉钉查询在 Desktop 执行，结果经脱敏和限制后通过 `connectorContexts` 注入会话。DWS 安装、授权和多组织 Profile 仍属于钉钉 Adapter 扩展。

### 腾讯会议

```text
Renderer -> ConnectorHost -> TencentMeetingConnectorAdapter
    -> TencentMeetingCredentialStore -> Electron safeStorage
    -> RemoteMcpTransport -> Tencent Meeting Official Remote MCP

Renderer -> CEES API TencentMeetingConnectorPlannerService
    -> 仅规划动态工具调用，不持有 Token，不执行工具
```

腾讯会议 Manifest：

| 字段 | 值 |
| --- | --- |
| `transportType` | `REMOTE_MCP` |
| `executionLocation` | `DESKTOP` |
| `authType` | `LOCAL_CREDENTIAL` |
| `supportsInstall` | `false` |
| `supportsDisconnect` | `true` |
| `supportsDynamicTools` | `true` |

## 5. Remote MCP Transport

`RemoteMcpTransport` 只接受 Adapter 在代码中提供的固定地址和动态凭据解析器，统一提供：

- 只允许无用户名、密码和 Fragment 的 HTTPS URL；
- 使用 HTTP POST 发送 JSON-RPC 2.0；
- 方法名必须符合 `<namespace>/<method>` 形式，例如 `tools/list`、`tools/call`；
- 固定 `Content-Type` 和 `Accept`，拒绝 Host、Cookie、Origin、Referer、Content-Length 等危险自定义头；
- 拒绝请求头控制字符和重定向；
- 统一超时、响应字节上限、JSON 解析、HTTP 错误和 JSON-RPC 错误；
- Transport 不向模型暴露 URL、Header 或凭据。

腾讯会议 Adapter 固定官方地址和 Skill 版本，通过请求头注入个人 Token。通用 Transport 本身不理解腾讯会议业务。

## 6. 本地凭据

本地凭据型连接器必须遵守：

- 凭据只在 Electron Main Process 处理；
- Renderer 只能提交首次连接输入，不能读取持久化凭据；
- 使用操作系统安全存储，安全存储不可用时拒绝明文降级；
- 每个连接器使用独立凭据文件和目录；
- 解绑删除密文、动态工具缓存和派生状态；
- 状态接口只能返回是否已配置、验证时间、工具数量和可恢复错误，不返回凭据摘要。

腾讯会议当前密文位置为 Electron `userData/connectors/tencent-meeting/credential.secure`。

## 7. 动态工具与规划

动态工具型连接器按以下边界运行：

1. Adapter 从官方服务发现工具并规范化名称、描述、参数 Schema 和风险；
2. Desktop 将用户问题和受限工具目录发送给 API 规划器；
3. API 把工具描述视为不可信输入，只允许返回目录内工具；
4. API 不接收凭据，不执行第三方工具；
5. Desktop 校验调用仍存在于最新目录中；
6. 写入和破坏性操作先确认，再由持有凭据的 Desktop 执行；
7. 结果脱敏、限长后作为 `ConnectorContext` 注入会话。

工具超过模型单次可接受数量时，规划器先做候选选择，再规划实际调用。当前腾讯会议最多接收 128 个目录项、选择 32 个候选并返回三条调用。

## 8. 安全边界

- 模型不能指定本地可执行文件、Shell、环境变量、网络地址、Header 或 Token；
- Adapter 只能执行当前发现且通过 Schema 校验的工具；
- 未识别工具按最高风险处理，不能默认只读；
- 写操作确认必须发生在外部调用之前，并显示精确参数；
- 第三方结果不能作为 CEES 租户、角色、数据范围或正式业务写入依据；
- 外部数据写入 CEES 正式资源仍必须调用 `apps/api` 版本化业务接口并经过权限、审计和幂等校验；
- 凭据字段和超大响应在进入模型上下文前移除或拒绝；
- 各连接器按协议选择凭据位置：需要服务端 Secret 的放 API，本地个人 Token 型放 Desktop，不能一刀切。

## 9. UI 约定

连接器市场使用紧凑等高卡片。未连接态使用“+ / 连接”操作并直接进入连接流程；已连接态使用“去对话”操作并新建助手会话；卡片主体打开详情。外层卡片不展示传输协议、安装版本等技术字段，完整描述、账号状态、解绑和重新连接进入详情。

腾讯会议连接时打开官方 AI Skill 页面并显示 Token 输入；连接后只显示 Token 已验证、动态工具数量和验证时间，不回显 Token。

## 10. 演进原则

1. 新连接器先确定官方认证和执行协议，再选择 Transport；
2. 通过 Manifest 和 Adapter 接入通用生命周期，不复制市场页面；
3. 先做动态只读能力，再为具体写操作建立风险与确认；
4. 只有写入 CEES 正式数据时才进入 API 业务命令和审计闭环；
5. 契约、客户端、测试和主设计文档必须同步；
6. 不为尚未接入的厂商提前抽象凭据或协议细节。

腾讯会议详细设计见 [腾讯会议连接器](../product/tencent-meeting-connector.md)。
