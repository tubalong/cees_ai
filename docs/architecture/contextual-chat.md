# 上下文对话

> 状态：MVP 已实现。最后更新：2026-09-08。

## 1. 目标与边界

ai-service 提供无状态、多轮、流式的内部对话生成能力，并支持 `standard` 与 `ultra` 两种执行模式。调用方在每一轮传入可信系统指令、可选的历史摘要和按时间排序的近期消息，ai-service 负责上下文预算、模型路由和最终回答生成。

ai-service 不持久化正式会话、消息或摘要。`conversation_id` 只用于调用关联和日志；调用方仍是会话状态的事实源。桌面端、移动端和第三方客户端不得直接访问这些内部接口。

本阶段实现的是 Codex 式多轮对话体验，不实现文件系统、Shell、工具调用、审批、长期任务或完整 Agent 状态机。

## 2. 内部接口

- `POST /internal/v1/chat/invoke`：非流式生成一条 Assistant 回答；
- `POST /internal/v1/chat/stream`：通过 SSE 流式生成一条 Assistant 回答；
- `POST /internal/v1/chat/compact`：将既有摘要和一段历史消息压缩成可复用摘要。

所有接口要求 `X-AI-Internal-Token`。正式 Schema、默认值、长度限制、事件联合和错误响应以 `packages/contracts/openapi/ai-service.openapi.yaml` 为准。

## 3. 上下文模型

`ChatRequest` 包含：

- `conversation_id`：调用关联 ID，不在 ai-service 中建立持久化 Session；
- `mode`：`standard` 或 `ultra`，省略时默认为 `standard`；
- `instructions`：可信内部调用方提供的系统指令；
- `conversation_summary`：早期历史的压缩摘要；
- `messages`：近期 `user`/`assistant` 消息，最后一条必须是 `user`；
- `max_output_tokens`：可选覆盖值，但不能超过模式和模型 Profile 的双重上限。

上下文按照“基础安全指令、调用方指令、历史摘要、近期消息”的顺序组装。当前 token 数使用 UTF-8 字节数除以 4 并叠加每条消息固定开销的确定性估算，不声称与任一 Provider 的精确 tokenizer 等价。

如果全部近期消息无法放入模式预算，服务从最新消息向前保留连续后缀，并避免让截断后的上下文以孤立 Assistant 消息开头。最后一条用户消息不能放入预算时返回 `CHAT_CONTEXT_TOO_LARGE`，不会静默删除本轮问题。

`context_usage.strategy`：

- `full`：请求中的全部消息都被采用，且未使用历史摘要；
- `summary_plus_recent`：使用历史摘要和近期消息；
- `recent_only`：没有摘要，只保留了消息后缀。

单次 Chat 请求原始文本总量限制为 1 MiB。

## 4. Standard 与 Ultra

模式策略由 `models.toml` 的 `[chat]` 和 `[chat.modes.*]` 配置，不允许 HTTP 请求覆盖 Provider、模型、Profile、temperature、reasoning effort、超时或重试策略。

默认开发配置：

| 模式 | 角色 | Reasoning | 默认输出预算 | 上下文预算 |
| --- | --- | --- | --- | --- |
| standard | default | 关闭 | 2048 | 65536（估算 token） |
| ultra | reasoning | high | 8192 | 131072（估算 token） |

`ultra` 流式调用会把配置的 reasoning effort 传入 `LLMRouter.start_stream`。DeepSeek Provider 显式启用 thinking，但 SSE 只传输阶段状态和最终正文，不传输 Provider 原始推理内容。

模式只能在各自角色的候选 Profile 内回退；Chat API 不接受 `llm_profile`，避免调用方固定单一模型、绕过回退或把多阶段策略绑定到错误 Profile。

## 5. 流式事件

Chat SSE 事件顺序为：

```text
started
status(reasoning)?
status(answering)
content_delta*
usage?
completed
```

流开始后发生错误时以 `error` 终止。`started` 会在上游模型产生首个 token 前立即发送，因此 Ultra 的 reasoning 阶段不会表现为无响应等待。`status` 只表示执行阶段，`answering` 事件携带最终选定的 Profile、Provider、模型和 fallback 次数。

客户端断开时生成器关闭上游流。Provider 流开始前的瞬时错误仍可按 `LLMRouter` 规则在同一角色候选中回退；开始输出后不拼接其他模型结果。

## 6. 对话压缩

`/chat/compact` 接收可选 `previous_summary` 和一段消息，使用配置的 `compaction_role` 生成新摘要。摘要应保留：

- 已确认事实和决策；
- 用户偏好和约束；
- 未解决问题；
- 重要引用和后续任务。

响应返回 `summarized_through_message_id`，取输入最后一条消息的可选 ID。调用方保存摘要，并在后续 `/chat/invoke` 或 `/chat/stream` 中作为 `conversation_summary` 传回。

压缩输入不会静默截断；超过 `compaction_context_budget_tokens` 时返回 `CHAT_CONTEXT_TOO_LARGE`。Provider 达到输出上限时返回 `CHAT_COMPACTION_TRUNCATED`，不把不完整摘要作为成功结果。

## 7. 失败语义

- 最后一条消息不是 `user`：`INVALID_CHAT_REQUEST`，HTTP 422；
- 原始 Chat 文本超过 1 MiB：`INVALID_CHAT_REQUEST`，HTTP 422；
- 上下文超过模式或压缩预算：`CHAT_CONTEXT_TOO_LARGE`，HTTP 422；
- 请求输出预算超过模式上限：`INVALID_CHAT_REQUEST`，HTTP 422；
- Chat 配置或模式不可用：`AI_SERVICE_NOT_READY` / `CHAT_MODE_UNAVAILABLE`，HTTP 503；
- 非流式 Provider 未返回非空文本：`CHAT_OUTPUT_INVALID`，HTTP 502；
- 压缩摘要为空或无效：`CHAT_SUMMARY_INVALID`，HTTP 502；
- 压缩达到输出上限：`CHAT_COMPACTION_TRUNCATED`，HTTP 502；
- 流开始后瞬时中断：终止 `CHAT_STREAM_INTERRUPTED` SSE 事件；
- 流开始后永久失败：终止 `CHAT_STREAM_FAILED` SSE 事件。

## 8. 调用方适配要求

调用方需要：

1. 持久化正式 Conversation、Message 和摘要；
2. 每轮传入完整可用历史，或 `conversation_summary + recent messages`；
3. 保证最后一条消息为当前用户消息；
4. 将产品展示值映射为小写 `standard` / `ultra`；
5. 不传 Provider、模型、Profile 或 reasoning effort；
6. 流式处理 `started`、`status`、`content_delta`、`usage`、`completed` 和 `error`；
7. 拼接 `content_delta` 并在完成后保存最终 Assistant 消息；
8. 保存 compact 响应的摘要及 `summarized_through_message_id`；
9. 在用户取消时断开内部请求；
10. 将 `finish_reason=length` 视为可能截断的回答。
