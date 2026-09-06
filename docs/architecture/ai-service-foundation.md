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

`apps/ai-service/config/models.toml` 定义命名 profile 和 `default`、`structured`、`reasoning`、`rag` 角色。Secret 不进入 TOML，`api_key_env` 只保存环境变量名称。

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

## 5. 后续扩展规则

真实业务出现后，应新增专用契约、领域 Schema、权限输入和测试，再由业务模块调用通用底座。不得直接把通用 invoke 暴露给桌面端或移动端，也不得在 ai-service 中创建正式业务资源。
