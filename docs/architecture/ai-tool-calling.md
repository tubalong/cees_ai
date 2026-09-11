# AI Tool Calling

> 状态：MVP 已实现。本文描述 ai-service 的通用 Tool Calling 运行时边界。

## 1. 目标

ai-service 负责“让模型选择工具并解析 Tool Call”，不负责执行业务工具。NestJS 仍负责权限、额度、幂等、COS、FileObject、AIActionDraft、审计和正式资源写入。

## 2. 能力范围

- 接收内部调用方传入的 tools 定义。
- 使用 LangChain `bind_tools(tool_choice="auto")` 调用模型。
- 将完整 `AIMessage.tool_calls` 或流式 `tool_call_chunks` 解析为统一 `ToolCall`。
- 流式返回 `content_delta` 或 `tool_calls`。

## 3. 内部接口

`POST /internal/v1/chat/tool-turn/stream`

- 每次调用只执行一个模型回合。
- 请求包含 `messages` 与 `tools`。
- 响应 SSE 联合为：
  - `started`
  - `tool_calls`
  - `content_delta`
  - `usage`
  - `completed`
  - `error`

## 4. 消息模型

`ToolTurnMessage` 支持：

- `user`
- `assistant`
- `tool`

带 `tool_calls` 的 Assistant 消息会在下一轮调用时与对应 `ToolMessage` 配对。`tool_call_id` 必须精确匹配，否则返回 `INVALID_TOOL_TURN_REQUEST`。

## 5. 模型配置

- `ModelRole.orchestrator` 是 Tool Calling 专用角色。
- `ModelCapability.tool_calling` 声明 profile 支持工具调用。
- `models.toml` 的 `roles.orchestrator` 候选必须支持 `tool_calling`。

## 6. Provider 行为

- OpenAI-compatible Provider 使用 `bind_tools`。
- DeepSeek 带 tools 调用时自动禁用 thinking。
- 流式模式下按 index 聚合 `tool_call_chunks`，并要求最终 arguments 为 JSON object。
- 工具名称与 arguments 不合规时抛出 `ProviderOutputError`。

## 7. 边界

- ai-service 不保存工具清单。
- ai-service 不执行业务工具。
- ai-service 不接入 COS、Prisma 或业务数据库。
- 业务 Tool Loop 由 NestJS 控制，并按需多次调用本接口。
