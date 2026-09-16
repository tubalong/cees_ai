# AI Service 通用基础设施

> 状态：基础设施已落地。本文描述当前实现，不代表任何具体业务 AI 功能已经确定。

## 1. 当前能力

ai-service 只提供：

- `/health`：进程存活；
- `/ready`：模型目录、角色映射、Chat 模式、密钥和生产安全策略校验；
- `/internal/v1/llm/invoke`：供 NestJS 使用的内部非流式模型调用；
- `/internal/v1/llm/stream`：供 NestJS 使用的内部文本 SSE 模型调用；
- `/internal/v1/chat/invoke`：无状态多轮上下文对话；
- `/internal/v1/chat/stream`：带阶段状态的上下文对话 SSE；
- `/internal/v1/chat/compact`：将历史消息压缩为调用方可持久化的摘要；
- `/internal/v1/chat/tool-turn/stream`：单次工具能力回合的 SSE，返回 `content_delta` 或统一 `tool_calls`；
- `/internal/v1/images/generate`：通过配置的图片生成 profile 返回 base64 图片与执行元数据；
- `/internal/v1/documents/*`：领域无关的 `DocumentSpec` 组合与 DOCX 渲染。

工作记录、会议解析、会议总结、知识问答、管理简报和文档向量化不属于当前范围。通用文档生成不查询这些业务数据，也不创建正式文件记录。桌面端、移动端仍保留的相关页面只是 UI 原型。

## 2. 框架职责

- LangChain 负责 OpenAI-compatible 模型调用、消息转换和 JSON Schema 结构化输出。
- LangGraph 不封装业务注册中心，只提供 request-scoped `WorkflowRuntimeContext`；冒烟测试验证异步 Graph 能从 context 获取模型路由器。
- LlamaIndex 不使用全局 `Settings`；LangChain LLM 和 embedding 通过薄适配按索引或调用显式传入。知识库 RAG 已落地真实 `PGVectorStore`（独立 `cees_ai_vectors` database）与 OpenAI-compatible embedding（L2 归一化），见 [知识库 RAG](knowledge-rag.md)。
- python-docx 将受控 `DocumentSpec` 确定性渲染为 DOCX，不执行模型生成的 XML 或模板路径。

知识库 RAG 已接入 pgvector 与外部 embedding 服务（块 4），见 [知识库 RAG](knowledge-rag.md)；Qdrant、Milvus 或完整业务 Agent 不在当前范围。Tool Calling 只负责“模型选择工具并解析 Tool Call”，业务工具执行、权限、额度和正式资源写入仍由 NestJS 负责；LangGraph 不承载业务 Tool Loop。流式接口只传输最终正文、统一 Tool Call 和执行元数据，不传输 Provider 原始推理内容。

## 3. 多模型配置

`apps/ai-service/config/models.toml` 定义 `mock`、`openai_compatible`、`deepseek` 命名 profile、`default`/`structured`/`reasoning`/`rag` 角色，以及 `standard`/`ultra` Chat 模式策略。Secret 不进入 TOML，`api_key_env` 只保存环境变量名称。

- 未指定 profile：按角色候选顺序执行；
- 连接、超时、限流和 provider 5xx：允许切换下一候选；
- 鉴权、参数、内容拒绝和结构化输出错误：不跨模型回退；
- 显式 profile：必须属于角色白名单，并精确执行、不回退；
- 生产环境角色不得绑定 Mock。

DeepSeek V4 默认启用 thinking，但其 thinking 模式不接受 LangChain `function_calling` 结构化输出所需的强制 `tool_choice`。因此 DeepSeek 的 JSON Schema 调用在创建 structured wrapper 时显式绑定 `thinking.type=disabled`；普通文本 invoke、stream 和 reasoning 角色不受影响。文档 quality Planner 通过 reasoning 角色显式启用 thinking，并使用独立的 reasoning effort 与 token 预算。`temperature` 与 token 上限也必须在 wrapper 创建阶段绑定，不能作为 wrapper `ainvoke` 的参数传入，否则 LangChain 不会把它们发送给 Provider。

配置在进程启动时读取，修改后需要重启。Readiness 不主动访问模型供应商。

## 4. invoke 与 stream 安全边界

调用方只能传消息、角色、白名单 profile、`temperature` 和 `max_output_tokens`。Provider、模型名、base URL、密钥、超时和重试不能由请求覆盖。

- 最多 64 条消息，总内容最大 256 KiB；
- 只支持 system/user/assistant 文本消息；
- JSON Schema 最大 32 KiB、根类型必须是 object，禁止远程 `$ref`；
- 所有调用要求 `X-AI-Internal-Token`；
- 日志不记录消息正文、Schema、密钥或 base URL；
- NestJS 通过可复用 `AiInvocationRecorderService` 根据 execution 元数据写入 `AIInvocationLog`；Chat 额外关联成员、本地会话和轮次，但不记录正文。

`stream` 只支持文本输出，事件顺序为 `started`、零个或多个 `content_delta`、可选 `usage`、`completed`。首个事件发送前发生瞬时 Provider 故障时可以切换候选 profile；流开始后发生故障则发送终止 `error` 事件，不再切换模型，避免把多个模型的输出拼接为一条回答。客户端断开连接时取消上游异步流。

`invoke` 的 execution 元数据和 `stream` 的 completed 事件均保留可选的 Provider `finish_reason`。其中 `length` 表示达到输出 token 上限，结果可能不完整；未知或未返回的结束原因使用 `null`，不跨 Provider 强制封闭枚举。

## 5. 上下文对话

Chat 接口以无状态方式接收可信指令、可选历史摘要和近期消息。ai-service 不保存正式 Conversation 或 Message；当前客户端在本地保存历史，并在每轮重放完整可用历史，或者传入 `conversation_summary + recent messages`。最后一条消息必须为 `user`。

`standard` 使用 default 角色；`ultra` 使用 reasoning 角色和配置的 reasoning effort。Chat API 不接受 `llm_profile`、Provider、模型名或 reasoning effort 覆盖。流式事件在模型首个 token 前发送 `started`，随后发送可选 reasoning 状态、携带执行元数据的 answering 状态、正文增量、用量和完成事件。内部模型行为见 [上下文对话](contextual-chat.md)，公开 API 链路见 [公开 AI 对话链路与 Token 计量](public-chat-api-and-token-metering.md)。

## 6. OpenAPI 与内部文档

`packages/contracts/openapi/ai-service.openapi.yaml` 是 ai-service HTTP 行为的唯一事实源。契约生成 Pydantic 模型、NestJS TypeScript 客户端和随 ai-service 发布的 OpenAPI JSON；FastAPI `/docs`、`/redoc` 与 `/openapi.json` 直接展示该生成契约。测试会另外根据实际 Python 路由生成 OpenAPI，并检查路径、方法、operationId、标签、认证、响应状态与主要 Schema 字段是否漂移。

内部契约 `0.2.0` 为 `ErrorResponse` 兼容增加可选 `execution`：仅当模型已经执行、但 Chat 回答或摘要随后被校验拒绝时返回，用于 NestJS 补记真实 Token；模型调用前失败仍省略该字段。该元数据不包含消息正文、回答或摘要。

内部认证继续使用 `X-AI-Internal-Token`，并在 OpenAPI 中声明为 Header `apiKey` 安全方案。该名称属于现有 NestJS 与 ai-service 内部契约，本次不做破坏性重命名。

- Development：文档开启，可查看、可调用；
- Staging：通过 `AI_DOCS_ENABLED=true` 开启，但不映射宿主机端口，仅用于容器内诊断；
- Production：通过 `AI_DOCS_ENABLED=false` 关闭；即使未显式配置，`NODE_ENV=production` 也默认关闭文档；
- 文档开关不影响 `/health`、`/ready` 和受认证的 invoke、stream 本身，生产环境中的 NestJS 仍可正常调用内部接口；
- 桌面端、移动端和第三方客户端不得通过该 Swagger 绕过 NestJS 的认证、权限、租户、配额和审计边界。

## 5.1 Tool Calling 与图片生成

Tool Calling 能力只开放给内部可信调用方。NestJS 根据租户能力和权限传入 tools 定义，ai-service 通过 LangChain `bind_tools` 调用模型，并把 `AIMessage.tool_calls` 或流式 `tool_call_chunks` 解析为统一 `ToolCall`。

- `/internal/v1/chat/tool-turn/stream` 一次只执行一个模型回合；
- 模型要调用工具时返回 `tool_calls`，否则返回 `content_delta*`；
- `ToolMessage.tool_call_id` 必须精确匹配前置 Assistant `tool_calls` 中的 ID；
- 业务 Tool Loop 在 NestJS 执行，ai-service 不执行 `generate_image` 等业务工具；
- `orchestrator` 角色候选必须声明 `tool_calling` capability。

图片生成由独立 `ImageRouter` 处理，不复用 `LLMRouter`：

- `[image_profiles.*]` 与 Chat Profile 分离；
- 图片 profile 只支持 `mock` 与 `openai_compatible`；
- 多个启用的图片 profile 按声明顺序组成主备候选，主模型瞬时失败时回退到下一候选；
- `/internal/v1/images/generate` 返回 base64 图片、`content_type` 和 execution 元数据；
- ai-service 不写 COS、不建正式文件、不校验租户额度。

详细设计见 [AI Tool Calling](ai-tool-calling.md) 与 [Image Generation](image-generation.md)。

## 7. 后续扩展规则

真实业务出现后，应新增专用契约、领域 Schema、权限输入和测试，再由业务模块调用通用底座。不得直接把通用 invoke 或 stream 暴露给桌面端或移动端，也不得在 ai-service 中创建正式业务资源。
