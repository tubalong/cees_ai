# Desktop 连接器运行时

## 1. 状态

- 已落地：提取通用连接器 Manifest、状态、工具、计划调用与上下文类型。
- 已落地：钉钉 DWS 通过兼容类型使用通用连接器核心，现有 IPC、页面和执行行为不变。
- 已落地：增加 `ConnectorAdapter`、`ConnectorRegistry`，钉钉成为第一个通过注册中心获取的适配器。
- 已落地：现有钉钉专用 IPC 保持不变，但其实现统一委托给 `DingTalkConnectorAdapter`。
- 已落地：增加通用 `LocalCliTransport`，统一固定命令、参数数组、超时、输出上限、环境变量、JSON 解析和结构化错误；DWS 日常命令已迁移使用。
- 已落地：增加 `ConnectorHost` 和通用 Electron IPC/Preload API，统一列表、状态、连接、解绑、工具发现、执行、失败刷新和状态事件。
- 已落地：Desktop 连接器市场通过 `ConnectorManifest[]` 动态渲染卡片，并通过通用 Preload API 查询状态、连接、解绑和监听状态事件。
- 已保留：`window.cees.connectors.dingtalk` 与旧钉钉 IPC/状态事件继续兼容，用于 Profile 选择、DWS 版本检查、升级与回滚等提供方扩展能力。
- 已落地：增加通用 `HttpApiTransport`，统一固定服务地址、路径白名单、超时、响应大小限制、JSON 解析和结构化错误。
- 已落地：腾讯会议 Manifest、市场入口和五类只读工具 Schema；Desktop 市场卡片已接入 API OAuth、状态轮询和解绑。
- 已落地：公开契约 `0.37.1` 冻结腾讯会议成员级 OAuth、状态、解绑、工具发现和批量只读执行接口，并兼容修正官方 `auth_code` 回调字段。
- 已落地：腾讯会议服务端 OAuth State、Token 加密托管、刷新租约、状态查询、幂等解绑和审计。
- 已落地：腾讯会议服务端只读 API 网关，提供固定工具发现、顺序执行、Scope 过滤、字段脱敏、分页适配、响应限制和审计。
- 待实现：远程 MCP Transport 和混合执行方式。
- 已落地：腾讯会议 Desktop 真实授权接线；Desktop 不保存提供方 Token，也不建设独立会议业务页面。
- 已落地：腾讯会议连接器进入 Assistant 原生 Tool Loop；连接器写操作及其二次确认机制仍待按具体需求设计。

## 2. 目标

Desktop 连接器运行时为钉钉、企业微信、腾讯会议及后续外部系统提供统一生命周期和执行边界。统一的是连接状态、能力发现、结构化调用、错误处理和安全策略，不强制外部厂商使用同一种协议。

```text
Assistant
    -> Connector Runtime
        -> Connector Adapter
            -> Local CLI / Local MCP / Remote MCP / HTTP API / SDK / WebSocket
                -> 外部官方服务
```

## 3. 当前边界

当前已经形成以下通用运行时基础：

```text
ConnectorManifest
ConnectorStatus
ConnectorTool
ConnectorPlannedCall
ConnectorContext
ConnectorAdapter
ConnectorRegistry
LocalCliTransport
HttpApiTransport
ConnectorHost
```

Renderer 市场页已经使用通用 IPC，旧钉钉接口作为兼容别名和扩展入口继续存在：

```text
Renderer
    -> 通用 Connector Preload API
        -> ConnectorHost
            -> ConnectorRegistry
                -> DingTalkConnectorAdapter -> LocalCliTransport -> dws
                -> TencentMeetingConnectorAdapter
                    -> CEES API Connector Gateway（已实现）
                        -> Tencent Meeting OAuth / Open API
```

通用 IPC 当前包括 `list/status/connect/disconnect/tools/execute` 和统一状态事件。市场页根据 Manifest 的安装、解绑、授权与版本管理声明决定通用交互；未连接态统一使用简洁卡片和双图标连接弹窗，不向普通用户展示安装版本、传输类型等实现细节，实际安装与授权策略仍由 Adapter 和 Manifest 决定。Profile 选择、版本升级与回滚仍属于钉钉扩展能力，暂不强制所有连接器实现。腾讯会议已完成公开 OpenAPI、Prisma OAuth 托管、API 只读网关、Desktop 市场卡片授权闭环以及 Assistant 原生 Tool Loop 接入。腾讯会议正式查询不通过 Desktop 预执行，而由 Assistant Tool Loop 在 API 内部按当前租户成员身份执行。现有钉钉对话前执行 DWS 并通过 `connectorContexts` 注入结果的流程不变。

腾讯会议验证了 API 执行型连接器的正式会话路径：静态注册给模型的五个只读工具只负责参数校验和结果摘要，实际 OAuth 凭据读取、刷新、Scope 校验、字段过滤、大小限制和审计全部复用 `TencentMeetingGatewayService`。工具调用通过 `TenantContext` 恢复执行时租户与成员身份，自然日范围按租户时区计算，“下一场会议”使用从查询时刻开始的滚动七天窗口；安全错误摘要与内部排障信息分离，避免上游响应或 Token 进入模型上下文。会议 ID 仅作为持久化 TOOL 消息中的后续调用引用，不在普通用户回答中主动展示。

API 型连接器的集成测试边界固定为 `ToolRegistry -> ToolPolicy -> Assistant Tool -> Provider Gateway`。测试必须使用真实注册表、策略与网关实现，只在外部 Provider、OAuth 凭据存储和网络层使用受控替身，并至少覆盖租户/成员隔离、授权撤销、Scope 不足、敏感字段过滤和多轮资源 ID 传递。真实 OAuth 回调与线上数据作为发布前手工验收，不把第三方账号或 Secret 引入 CI。

## 4. Manifest

Manifest 描述连接器的静态能力，包括：

- 标识、名称、描述与图标；
- 执行传输方式；
- Desktop、API 或混合执行位置；
- 授权方式；
- 是否支持安装、解绑、账号 Profile、动态工具和版本管理。

当前钉钉 Manifest 声明为 Desktop 本地 CLI、OAuth 授权、支持安装、解绑、账号 Profile、动态工具与版本管理。腾讯会议 Manifest 声明为 API 侧 HTTP API、OAuth 授权、不安装本地组件并支持动态只读工具。注册中心新增连接器后，市场页可直接展示其名称、描述、连接状态和基础生命周期操作，无需复制一套页面。Manifest 只描述能力，不保存 Token、Cookie、Secret 或用户账号数据。

## 5. Local CLI Transport

`LocalCliTransport` 只接受由 Adapter 提供的固定可执行文件和结构化参数数组，统一提供：

- `execFile` 且显式 `shell=false`；
- 超时、最大输出字节数与隐藏窗口；
- 基础环境变量和单次调用环境变量合并；
- 文本、JSON、版本和健康检查；
- 非零退出、超时、stdout/stderr 和退出信号的结构化错误。

钉钉受管 DWS 直接执行固定 `dws.exe`。Windows 系统安装兼容路径仍只用于既有状态与兼容操作；对话业务工具继续要求受管 DWS。DWS 官方 PowerShell 安装器保留独立的下载、SHA-256 校验和固定参数流程，不作为通用 CLI 能力暴露。

## 6. 安全边界

- AI 只能使用受信任 Schema 转换出的工具 ID 和结构化参数。
- 模型不能指定可执行文件、Shell、环境变量或任意本地路径。
- 外部数据写入 CEES 正式业务资源时仍由 `apps/api` 进行租户、权限和审计校验。
- 通用类型不改变钉钉现有的只读过滤、参数白名单、输出脱敏和结果大小限制。
- API 型连接器的第三方应用 Secret、Access Token 和 Refresh Token 必须保存在 `apps/api`，不得写入 Desktop Manifest、Renderer Storage 或安装包。
- `HttpApiTransport` 只能请求 Adapter 预先配置的固定服务和路径前缀，模型不能直接指定 URL、Header 或认证信息。

腾讯会议阶段设计见 [腾讯会议连接器](../product/tencent-meeting-connector.md)。

## 7. 后续演进

1. 已完成：在契约和 `apps/api` 中补齐腾讯会议 OAuth、Token 托管和只读 API 网关。
2. 已完成：Desktop 市场卡片与服务端 OAuth 状态联调，验证 API 执行型连接器的授权生命周期。
3. 按真实需求增加 Remote MCP Transport 和混合执行方式。
4. 已完成：将腾讯会议连接器五类只读调用接入 Assistant 原生 Tool Loop。
5. 已完成：建立 API 型连接器 Assistant 集成测试边界并对腾讯会议只读链路完成覆盖。
6. 为写操作增加风险分级、显式二次确认和审计闭环。
