# Desktop 连接器运行时

## 1. 状态

- 已落地：提取通用连接器 Manifest、状态、工具、计划调用与上下文类型。
- 已落地：钉钉 DWS 通过兼容类型使用通用连接器核心，现有 IPC、页面和执行行为不变。
- 待实现：`ConnectorAdapter`、`ConnectorRegistry` 和通用 Electron IPC。
- 待实现：通用 `LocalCliTransport`、远程 MCP Transport 和混合执行方式。
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

钉钉仍然使用既有专用 IPC 和 DWS 执行流程：

```text
Renderer
    -> Electron IPC
        -> dingtalk-connector
            -> dws
```

本阶段不修改公开 OpenAPI、不修改 Prisma、不新增企业微信或腾讯会议连接器，也不改变对话前执行 DWS 并通过 `connectorContexts` 注入结果的现有流程。

## 4. Manifest

Manifest 描述连接器的静态能力，包括：

- 标识、名称、描述与图标；
- 执行传输方式；
- Desktop、API 或混合执行位置；
- 授权方式；
- 是否支持安装、解绑、账号 Profile、动态工具和版本管理。

当前钉钉 Manifest 声明为 Desktop 本地 CLI、OAuth 授权、支持动态工具与版本管理。Manifest 只描述能力，不保存 Token、Cookie、Secret 或用户账号数据。

## 5. 安全边界

- AI 只能使用受信任 Schema 转换出的工具 ID 和结构化参数。
- 模型不能指定可执行文件、Shell、环境变量或任意本地路径。
- 外部数据写入 CEES 正式业务资源时仍由 `apps/api` 进行租户、权限和审计校验。
- 通用类型不改变钉钉现有的只读过滤、参数白名单、输出脱敏和结果大小限制。

## 6. 后续演进

1. 增加 `ConnectorAdapter` 并将钉钉包装为首个 Adapter。
2. 增加 `ConnectorRegistry`，由注册中心管理连接器清单。
3. 提取安全的 `LocalCliTransport`，供 DWS 与 `wecom-cli` 复用。
4. 增加通用 Electron IPC 和 Manifest 驱动的连接器市场。
5. 接入企业微信 CLI，验证通用抽象。
6. 按真实需求增加 Remote MCP Transport。
7. 最后将本地连接器调用接入 Assistant 原生 Tool Loop。
