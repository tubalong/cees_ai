# AI Service 通用基础设施

> 状态：基础设施已落地。本文描述当前实现，不代表任何具体业务 AI 功能已经确定。

## 1. 当前能力

ai-service 只提供：

- `/health`：进程存活；
- `/ready`：模型目录、角色映射、密钥和生产安全策略校验；
- `/internal/v1/llm/invoke`：供 NestJS 使用的内部非流式模型调用。

工作记录、会议解析、会议总结、知识问答、管理简报和文档向量化不属于当前范围。桌面端、移动端仍保留的相关页面只是 UI 原型。

## 2. 框架职责

- LangChain 负责 OpenAI-compatible 模型调用、消息转换和 JSON Schema 结构化输出。
- LangGraph 不封装业务注册中心，只提供 request-scoped `WorkflowRuntimeContext`；冒烟测试验证异步 Graph 能从 context 获取模型路由器。
- LlamaIndex 不使用全局 `Settings`；LangChain LLM 和 embedding 通过薄适配按索引或调用显式传入。当前只验证内存索引和检索。

本阶段不接入 pgvector、Qdrant、Milvus、外部 embedding 服务、工具调用、SSE 或业务 Agent。

## 3. 多模型配置

`apps/ai-service/config/models.toml` 定义 `mock`、`openai_compatible`、`deepseek` 命名 profile 和 `default`、`structured`、`reasoning`、`rag` 角色。Secret 不进入 TOML，`api_key_env` 只保存环境变量名称。

- 未指定 profile：按角色候选顺序执行；
- 连接、超时、限流和 provider 5xx：允许切换下一候选；
- 鉴权、参数、内容拒绝和结构化输出错误：不跨模型回退；
- 显式 profile：必须属于角色白名单，并精确执行、不回退；
- 生产环境角色不得绑定 Mock。

配置在进程启动时读取，修改后需要重启。Readiness 不主动访问模型供应商。

## 4. invoke 安全边界

调用方只能传消息、角色、白名单 profile、`temperature` 和 `max_output_tokens`。Provider、模型名、base URL、密钥、超时和重试不能由请求覆盖。

- 最多 64 条消息，总内容最大 256 KiB；
- 只支持 system/user/assistant 文本消息；
- JSON Schema 最大 32 KiB、根类型必须是 object，禁止远程 `$ref`；
- 所有调用要求 `X-AI-Internal-Token`；
- 日志不记录消息正文、Schema、密钥或 base URL；
- NestJS 根据响应 execution 元数据写入 `AIInvocationLog`。

## 5. OpenAPI 与内部文档

`packages/contracts/openapi/ai-service.openapi.yaml` 是 ai-service HTTP 行为的唯一事实源。契约生成 Pydantic 模型、NestJS TypeScript 客户端和随 ai-service 发布的 OpenAPI JSON；FastAPI `/docs`、`/redoc` 与 `/openapi.json` 直接展示该生成契约。测试会另外根据实际 Python 路由生成 OpenAPI，并检查路径、方法、operationId、标签、认证、响应状态与主要 Schema 字段是否漂移。

内部认证继续使用 `X-AI-Internal-Token`，并在 OpenAPI 中声明为 Header `apiKey` 安全方案。该名称属于现有 NestJS 与 ai-service 内部契约，本次不做破坏性重命名。

- Development：文档开启，可查看、可调用；
- Staging：通过 `AI_DOCS_ENABLED=true` 开启，并使用 `AI_SERVICE_PORT` 映射 ai-service 端口，可查看、可调用，仅面向内部开发和运维人员；
- Production：通过 `AI_DOCS_ENABLED=false` 关闭；即使未显式配置，`NODE_ENV=production` 也默认关闭文档；
- 文档开关不影响 `/health`、`/ready` 和受认证的 invoke 本身，生产环境中的 NestJS 仍可正常调用内部接口；
- 桌面端、移动端和第三方客户端不得通过该 Swagger 绕过 NestJS 的认证、权限、租户、配额和审计边界。

## 6. 后续扩展规则

真实业务出现后，应新增专用契约、领域 Schema、权限输入和测试，再由业务模块调用通用底座。不得直接把通用 invoke 暴露给桌面端或移动端，也不得在 ai-service 中创建正式业务资源。
