# Desktop 连接器运行时

## 1. 状态

- 已落地：提取通用连接器 Manifest、状态、工具、计划调用与上下文类型。
- 已落地：钉钉 DWS 通过兼容类型使用通用连接器核心，现有 IPC、页面和执行行为不变。
- 已落地：增加 `ConnectorAdapter`、`ConnectorRegistry`，钉钉成为第一个通过注册中心获取的适配器。
- 已落地：现有钉钉专用 IPC 保持不变，但其实现统一委托给 `DingTalkConnectorAdapter`。
- 已落地：增加通用 `LocalCliTransport`，统一固定命令、参数数组、超时、输出上限、环境变量、JSON 解析和结构化错误；DWS 日常命令已迁移使用。
- 已落地：增加 `ConnectorHost` 和通用 Electron IPC/Preload API，统一列表、状态、连接、解绑、工具发现、执行、失败刷新和状态事件。
- 已保留：`window.cees.connectors.dingtalk` 与旧钉钉 IPC/状态事件继续兼容，现有页面无需同步修改。
- 待实现：远程 MCP Transport 和混合执行方式。
- 待实现：连接器进入 Assistant 原生 Tool Loop，以及写操作的二次确认机制。

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

当前阶段只提取无行为变化的基础类型：

```text
ConnectorManifest
ConnectorStatus
ConnectorTool
ConnectorPlannedCall
ConnectorContext
```

Renderer 已可使用通用 IPC，旧钉钉接口作为兼容别名继续存在：

```text
Renderer
    -> 通用 Connector Preload API
        -> ConnectorHost
            -> ConnectorRegistry
                -> DingTalkConnectorAdapter
                    -> LocalCliTransport
                        -> dws
```

通用 IPC 当前包括 `list/status/connect/disconnect/tools/execute` 和统一状态事件。Profile 选择、版本升级与回滚仍属于钉钉扩展能力，暂不强制所有连接器实现。本阶段不修改公开 OpenAPI、不修改 Prisma、不新增企业微信或腾讯会议连接器，也不改变对话前执行 DWS 并通过 `connectorContexts` 注入结果的现有流程。

## 4. Manifest

Manifest 描述连接器的静态能力，包括：

- 标识、名称、描述与图标；
- 执行传输方式；
- Desktop、API 或混合执行位置；
- 授权方式；
- 是否支持安装、解绑、账号 Profile、动态工具和版本管理。

当前钉钉 Manifest 声明为 Desktop 本地 CLI、OAuth 授权、支持动态工具与版本管理。Manifest 只描述能力，不保存 Token、Cookie、Secret 或用户账号数据。

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

## 7. 后续演进

1. 增加 `ConnectorAdapter` 并将钉钉包装为首个 Adapter。
2. 增加 `ConnectorRegistry`，由注册中心管理连接器清单。
3. 将连接器市场改为 Manifest 驱动，并逐步迁移页面使用通用 Preload API。
4. 接入企业微信 CLI，验证通用抽象。
5. 按真实需求增加 Remote MCP Transport。
6. 最后将本地连接器调用接入 Assistant 原生 Tool Loop。
