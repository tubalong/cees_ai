# Desktop 连接器运行时

## 1. 当前状态

- 已落地通用 `ConnectorManifest`、`ConnectorStatus`、`ConnectorTool`、`ConnectorPlannedCall`、`ConnectorContext`；
- 已落地 `ConnectorAdapter`、`ConnectorRegistry`、`ConnectorHost` 和通用 Electron IPC/Preload 生命周期；
- 已落地 `LocalCliTransport`，钉钉 DWS 作为 Desktop 本地 CLI 连接器运行；
- 已落地 `HttpApiTransport`，供固定 API 地址和路径白名单型连接器复用；
- 已落地 `RemoteMcpTransport`，提供固定 HTTPS 地址、JSON-RPC、动态安全请求头、超时、响应上限、禁止重定向和结构化错误；
- 已落地腾讯会议官方 CLI 托管安装、浏览器 OAuth、版本化命令 Schema、API 无副作用规划和 Desktop 确认执行；
- 已落地企业微信官方 CLI 托管安装、二维码机器人授权、动态 Schema、API 无副作用规划和 Desktop 确认执行；
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
    -> LocalCliTransport -> Managed @tencentcloud/tmeet
    -> Browser OAuth -> Tencent Meeting Open API

Renderer -> CEES API TencentMeetingConnectorPlannerService
    -> 仅规划版本化 CLI 工具调用，不持有 OAuth 凭据，不执行工具
```

腾讯会议 Manifest：

| 字段 | 值 |
| --- | --- |
| `transportType` | `LOCAL_CLI` |
| `executionLocation` | `DESKTOP` |
| `authType` | `OAUTH` |
| `supportsInstall` | `true` |
| `supportsDisconnect` | `true` |
| `supportsDynamicTools` | `false` |

Desktop 固定下载 `@tencentcloud/tmeet 1.0.18` 官方 npm 包并校验 SHA-256，只提取当前平台原生二进制。工具目录由 CEES 固定允许列表和已安装 CLI 的 `--help` 共同生成：允许列表控制可暴露命令，CLI 帮助提供当前版本真实参数 Schema。

### 企业微信

```text
Renderer -> ConnectorHost -> WeComConnectorAdapter
    -> LocalCliTransport -> Managed @wecom/cli
    -> WeCom intelligent bot authorization

Renderer -> CEES API WeComConnectorPlannerService
    -> 仅规划动态工具调用，不持有授权，不执行 CLI
```

企业微信 Manifest：

| 字段 | 值 |
| --- | --- |
| `transportType` | `LOCAL_CLI` |
| `executionLocation` | `DESKTOP` |
| `authType` | `QR_CODE` |
| `supportsInstall` | `true` |
| `supportsDisconnect` | `true` |
| `supportsDynamicTools` | `true` |

Desktop 固定下载 `@wecom/cli 1.3.2` 平台包并校验 SHA-256，只提取目标二进制。官方 CLI 的独立配置目录为 `userData/connectors/wecom/config`，不会上传 CEES API。企业微信能力由官方 CLI 动态目录和机器人实际授权决定，不承诺考勤、OA 审批或完整组织同步。动态工具缺少业务权限时，Adapter 返回结构化授权上下文，Renderer 展示官方授权入口并支持重新执行原问题。

## 5. Remote MCP Transport

`RemoteMcpTransport` 只接受 Adapter 在代码中提供的固定地址和动态凭据解析器，统一提供：

- 只允许无用户名、密码和 Fragment 的 HTTPS URL；
- 使用 HTTP POST 发送 JSON-RPC 2.0；
- 方法名必须符合 `<namespace>/<method>` 形式，例如 `tools/list`、`tools/call`；
- 固定 `Content-Type` 和 `Accept`，拒绝 Host、Cookie、Origin、Referer、Content-Length 等危险自定义头；
- 拒绝请求头控制字符和重定向；
- 统一超时、响应字节上限、JSON 解析、HTTP 错误和 JSON-RPC 错误；
- Transport 不向模型暴露 URL、Header 或凭据。

`RemoteMcpTransport` 当前不再用于腾讯会议，但继续作为其他固定远程 MCP 连接器的通用能力保留。任何新接入仍需由 Adapter 固定地址、鉴权头和方法范围，不能让模型提供网络目标。

## 6. 本地凭据

本地凭据型连接器必须遵守：

- 凭据只在 Electron Main Process 处理；
- Renderer 只能提交首次连接输入，不能读取持久化凭据；
- 使用操作系统安全存储，安全存储不可用时拒绝明文降级；
- 每个连接器使用独立凭据文件和目录；
- 解绑删除密文、动态工具缓存和派生状态；
- 状态接口只能返回是否已配置、验证时间、工具数量和可恢复错误，不返回凭据摘要。

腾讯会议 OAuth 凭据由官方 CLI 加密保存。Desktop 通过 `TMEET_CLI_CONFIG_DIR` 和 `TMEET_CLI_DATA_DIR` 将其隔离在 Electron `userData/connectors/tencent-meeting/config` 与 `data`，Renderer 和 API 不读取目录内容；解绑执行官方 logout 后删除两个专属目录。

企业微信授权由官方 CLI 保存在 Electron `userData/connectors/wecom/config`。该目录只在 Main Process 通过 `WECOM_CLI_CONFIG_DIR` 传给受管 CLI；Renderer 和 API 不读取目录内容。解绑删除本机配置，但企业微信侧已创建的机器人可能仍需用户自行管理。

## 7. 动态工具与规划

动态工具或版本化命令目录连接器按以下边界运行：

1. Adapter 从官方服务动态发现工具，或从固定允许列表与官方 CLI 帮助生成版本化目录；
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
- 各连接器按官方协议选择凭据位置：需要服务端 Secret 的放 API，官方本地 CLI 的 OAuth 凭据由 CLI 在 Desktop 专属目录管理，不能一刀切。

## 9. UI 约定

- 连接成功只表示基础身份授权有效，不表示所有业务域均已授权；
- 企业微信业务缺权必须展示确定性授权卡片，不允许只依赖模型文本；
- 官方授权 URL 必须由 Main Process 和 Renderer 双重限制为 `https://work.weixin.qq.com/ai/aiHelper/*`；
- 授权卡片需区分机器人创建者与普通使用者，并提供授权完成后的原问题重试；
- USER 消息的 `connectorContexts` 随会话详情回传，用于刷新后恢复卡片，不得被解释为 CEES 权限事实。

连接器市场使用紧凑等高卡片。未连接态使用“+ / 连接”操作并直接进入连接流程；已连接态使用“去对话”操作并新建助手会话；卡片主体打开详情。外层卡片不展示传输协议、安装版本等技术字段，完整描述、账号状态、解绑和重新连接进入详情。

腾讯会议连接时自动安装固定版官方 CLI 并由 CLI 打开浏览器 OAuth；连接后只显示授权用户、CLI 版本和工具数量，不显示或接收 Token。

## 10. 演进原则

1. 新连接器先确定官方认证和执行协议，再选择 Transport；
2. 通过 Manifest 和 Adapter 接入通用生命周期，不复制市场页面；
3. 先做动态只读能力，再为具体写操作建立风险与确认；
4. 只有写入 CEES 正式数据时才进入 API 业务命令和审计闭环；
5. 契约、客户端、测试和主设计文档必须同步；
6. 不为尚未接入的厂商提前抽象凭据或协议细节。

腾讯会议详细设计见 [腾讯会议连接器](../product/tencent-meeting-connector.md)。
