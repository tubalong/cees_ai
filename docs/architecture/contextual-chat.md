# 上下文对话

> 状态：ai-service 无状态上下文能力与 NestJS Assistant 适配已实现。最后更新：2026-09-14。

## 1. 目标与边界

ai-service 提供无状态、多轮、流式的内部对话生成能力，并支持 `standard` 与 `ultra` 两种执行模式。调用方在每一轮传入可信系统指令、可选的历史摘要和按时间排序的近期消息，ai-service 负责上下文预算、模型路由和最终回答生成。

ai-service 不持久化正式会话、消息或摘要。`conversation_id` 只用于调用关联和日志；NestJS Assistant 是会话状态的事实源，负责从 PostgreSQL 加载消息、摘要和工具结果后调用本服务。桌面端、移动端和第三方客户端不得直接访问这些内部接口，而是通过 NestJS 的 `/api/v1/conversations/*` 公开接口调用。

本服务实现无状态模型调用、上下文预算、压缩、视觉消息和单回合 Tool Calling；工具批准、正式资源写入、审计、取消/恢复和会话状态机均由 NestJS Assistant 负责。当前不引入 LangGraph。

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
- 每条消息的 `content` 是内容 parts 数组，支持 `text` 与 `image_url`；
- `max_output_tokens`：可选覆盖值，但不能超过模式和模型 Profile 的双重上限。

上下文按照“基础安全指令、调用方指令、历史摘要、近期消息”的顺序组装。当前 token 数使用文本 UTF-8 字节数除以 4、每张图片按固定预算计入，并叠加每条消息固定开销的确定性估算，不声称与任一 Provider 的精确 tokenizer 等价。各模式预算来自 `models.toml` 的 `context_budget_tokens`，并由 `/ready.chat_context_budgets` 暴露给 NestJS；NestJS 在调用 compact 前按同一口径预先压缩，ai-service 在最终模型调用前仍会做最后一道安全裁剪。

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

模式只能在各自角色的候选 Profile 内回退；Chat API 不接受 `llm_profile`，避免调用方固定单一模型、绕过回退或把多阶段策略绑定到错误 Profile。当消息包含 `image_url` parts 时，LLMRouter 会从该角色候选中过滤出声明 `vision` capability 的 profile；若无可用视觉 profile，返回 `UNSUPPORTED_MULTIMODAL`。

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

## 5.1 Tool Calling 回合

当模型需要调用工具时，调用方使用 `/internal/v1/chat/tool-turn/stream` 执行单个带 tools 的模型回合。该接口与 `/chat/stream` 分离，避免把普通对话的“最后一条必须是 user”约束强加给工具结果消息。

- ai-service 只返回 `tool_calls` 或 `content_delta*`；
- NestJS 执行工具后，将 `ToolMessage` 与前置 Assistant `tool_calls` 一起传回下一回合；
- `tool_call_id` 必须精确匹配；
- 业务工具执行、权限、额度和资源写入均在 NestJS 完成。

详细设计见 [AI Tool Calling](ai-tool-calling.md)。

## 6. 对话压缩

`/chat/compact` 接收可选 `previous_summary` 和一段消息，使用配置的 `compaction_role` 生成新摘要。摘要应保留：

- 已确认事实和决策；
- 用户偏好和约束；
- 未解决问题；
- 重要引用和后续任务。

响应返回 `summarized_through_message_id`，取输入最后一条消息的可选 ID。NestJS 保存摘要边界，并在后续模型调用中作为 `conversation_summary` 传回；客户端不直接调用 compact。

压缩输入不会静默截断；超过 `compaction_context_budget_tokens` 时返回 `CHAT_CONTEXT_TOO_LARGE`。Provider 达到输出上限时返回 `CHAT_COMPACTION_TRUNCATED`，不把不完整摘要作为成功结果。

## 6.1 视觉模型建议

图片理解应优先使用专用视觉模型，而不是强制主文本模型支持 `vision`。推荐单独配置一个视觉 profile，并按需加入可能接收图片的角色：

```toml
[profiles.vision-primary]
enabled = true
provider = "openai_compatible"
model = "your-vision-model"
base_url = "https://your-provider/v1"
api_key_env = "VISION_LLM_API_KEY"
modes = ["text"]
capabilities = ["chat", "vision"]
```

如果图片消息还需要触发工具调用，该 profile 还需声明 `tool_calling`。图片生成与编辑继续使用独立的 `[image_profiles.*]`，不与聊天视觉模型混用。

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

非流式回答为空、摘要无效或摘要达到输出上限时，Provider 已经产生实际调用成本。此类内部错误响应会携带可选 `execution` 元数据供 NestJS 记录 Token；请求校验、配置未就绪和模型调用前失败不携带该字段，避免把未执行请求误记为模型用量。

## 8. NestJS 与客户端适配要求

NestJS Assistant 通过 `AiServiceGateway` 统一调用本服务，公开入口是 `POST /api/v1/conversations/{conversationId}/turns` 及事件重放/取消接口。旧 `/api/v1/chat/*` 在当前开发阶段已删除，不保留兼容层。会话、消息、摘要、ToolCall、审计和正式资源均由 NestJS 持久化；`AIInvocationLog` 记录每次模型调用的执行元数据和 Token 指标。完整前端协议见 [Assistant / Conversation API](../api/assistant-api.md)。

客户端需要：

1. 通过会话 CRUD 获取并保存服务端 `conversationId`；本地只保留渲染缓存；
2. 每轮只提交本轮消息和 `Idempotency-Key`，历史与摘要由 NestJS 组装；
3. 图片先通过 File API 上传，再提交 `imageFileIds`；
4. 将产品展示值映射为小写 `standard` / `ultra`；
5. 不传 Provider、模型、Profile 或 reasoning effort；
6. 流式处理 `started`、`status`、`content_delta`、`usage`、`completed` 和 `error`；
7. 拼接 `content_delta`；服务端负责保存最终 Assistant 消息；
8. 按事件 `seq` 记录游标，断线使用事件重放接口；
9. 取消必须调用公开 cancel 接口，网络断开不是取消；
10. 将 `finish_reason=length` 视为可能截断的回答。

桌面端发送新消息后，应将本轮用户提问定位到消息视口顶部，并让后续流式回答在其下方持续展示，避免长会话仍停留在旧消息位置。消息区右侧滚动条旁提供按用户提问生成的快速导航：默认显示短横线，悬停或键盘聚焦时展开问题摘要，点击后平滑跳转到对应提问；当前视口最接近的提问使用主题色标识。

ai-service 不保存消息、回答或摘要正文；NestJS 保存会话事实。当前 Token 记录不等于企业或成员额度体系，也不执行额度扣减或超额拦截；额度预占/结算和人工审批属于后续能力。

## 9. 待实现与验证缺口

### 9.1 相关问题推荐（三个推荐回复）——后端已实现，前端待接入

**状态**：后端已实现（契约 + ai-service + NestJS 全链路落地，含单测）；桌面/移动端渲染与点击提问尚未实现。

**已确认方案与落地形态**：

- 生成方式：**随回答一次输出**——模型在最终回答末尾输出 `<follow_up_questions>["…"]</follow_up_questions>` 追问块，ai-service 流式剥离该块，正文照常流式下发；不再有第二次异步模型调用；
- 下发形态：**独立 SSE 事件 `related_questions`**，位于 `completed` 之后到达（seq 递增）；追问随 ai-service 的 `completed` 事件（`related_questions` 字段）一并返回，NestJS 在公开 `completed` 之后立即追加；无追问则不出现；
- 内容约束：至多 3 条、每条不超过 30 字的简短追问；ai-service 对块内容做严格 JSON 解析并过滤超长/空/非字符串条目；
- 持久化：追问落到 `assistant_turns.related_questions` JSONB 列，随事件流重放即可恢复，用户再次进入会话时仍能看到上次的追问推荐。

**落地明细**：

1. 契约（`packages/contracts`）：ai-service 内部契约移除 `/internal/v1/chat/related-questions` 端点，`ChatStreamCompletedEvent` 新增可选 `related_questions`（`ai-service.openapi.yaml` 0.7.0，开发阶段破坏性变更）；公开对话契约不变（`related_questions` 事件已在 0.33.0 定义）；三端客户端已重新生成；
2. ai-service（`apps/ai-service`）：`FollowUpStreamFilter` 流式剥离追问块；`FOLLOW_UP_INSTRUCTION` 作为 system 指令要求模型一次输出正文与追问，工具调用轮次不输出追问块；
3. NestJS Assistant（`apps/api`）：`TurnRunnerService.completeTurn` 读取 `completed.related_questions`，随 CAS 事务持久化到 Turn，并在公开 `completed` 事件之后追加 `related_questions` 事件；工具调用轮次的追问丢弃，仅最终回答轮生效；原异步生成方法与网关端点调用已删除。

**待做（前端）**：桌面端对话页回答末尾渲染推荐问题按钮，点击即发起新一轮提问（复用现有 turn 提交流程）；mobile 视契约形态跟进。

### 9.2 上下文压缩——已实现（代码 + 单测），真机长对话触发未验证

**实现状态：已实现**，两端均落地：

- NestJS 侧 `ContextBuilderService.loadHistoryWithCompaction`（`apps/api/src/assistant/runtime/context-builder.service.ts`）作为唯一策略源：
  - 触发条件双轨：文本消息数超过 **80 条**（`COMPACTION_THRESHOLD`），或「摘要 + 文本历史」估算 Token 超过模式预算的 **80%**（`COMPACTION_TOKEN_RATIO`，standard 64K / ultra 128K，预算来自 ai-service `/ready.chat_context_budgets`，未就绪时回退默认值）；
  - 压缩量取两条约束中「保留更少、压缩更多」的一方，压缩后保留最近 **20 条**（`RETAIN_RECENT_COUNT`）；
  - 压缩边界按 Turn 对齐（避免只摘要用户请求、把该轮回答留在增量区间造成语义重复或工具消息孤立）；
  - 摘要持久化到 `ConversationSummary`（`summary` + `summarizedThroughMessageId` 边界），后续轮次只加载边界之后的增量消息，避免摘要与原始历史重复注入；工具轮次（`buildToolTurnMessages`）截断点同样对齐轮次边界。
- ai-service 侧 `ChatCompactor.compact`（`/internal/v1/chat/compact`）：按 `compaction_role` 用 LLM 生成摘要；空摘要返回 `CHAT_SUMMARY_INVALID`、输出截断返回 `CHAT_COMPACTION_TRUNCATED`，不把不完整摘要当作成功结果。
- 测试覆盖：`context-builder.service.spec.ts` 已覆盖触发与边界对齐等场景；ai-service 压缩错误语义有 pytest 覆盖。

**验证缺口（待办）**：本地开发库 `conversation_summaries` 暂无记录（截至 2026-09-18 为 0 条），说明压缩链路尚未在真实长对话中被实际触发验证。待办：构造超过 80 条（或 Token 超预算）的长对话实测一次，验证「摘要生成 → 边界持久化 → 后续轮次上下文恢复 → 工具轮次不拆散」的端到端行为；如摘要质量不达预期再调优 `compaction_role` 提示词。

**与长期记忆的边界**：压缩是会话内能力，不跨会话生效；跨会话长期记忆（新会话继承用户偏好与历史决策）尚未规划实现，如需支持需另立设计（参考记忆功能规划）。
