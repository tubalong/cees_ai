# apps/ai-service — 通用 AI 基础设施

FastAPI 内部服务，负责受控 LLM 调用与未来 AI 工作流的运行时基础设施。当前不包含工作记录、会议、知识库、简报等业务能力，也不直接连接业务数据库或写入正式业务数据。

## 技术栈

- Python 3.14 + uv
- LangChain：模型调用与结构化输出
- LangGraph：未来业务工作流的原生编排能力
- LlamaIndex：未来索引与检索能力的薄适配

## HTTP 接口

- `GET /health`：进程存活检查
- `GET /ready`：配置与密钥就绪检查
- `POST /internal/v1/llm/invoke`：需要 `X-AI-Internal-Token` 的内部非流式调用
- `POST /internal/v1/llm/stream`：需要 `X-AI-Internal-Token` 的内部文本 SSE 调用

正式契约位于 `packages/contracts/openapi/ai-service.openapi.yaml`。业务客户端不得直接调用通用 invoke 或 stream，必须由 NestJS 统一认证、审计和编排。`X-AI-Internal-Token` 是 OpenAPI 中的 `apiKey` 安全方案，并通过 Swagger 的 Authorize 操作设置。

`stream` 依次发送 `started`、零个或多个 `content_delta`、可选 `usage` 和 `completed` 事件。首个事件发送前允许在瞬时 Provider 故障时切换候选模型；流开始后的故障发送终止 `error` 事件，不拼接备用模型输出。该接口只传输最终正文增量，不暴露 Provider 原始推理内容。JSON Schema 结构化输出继续使用非流式 `invoke`。

非流式响应的 `execution.finish_reason` 与流式 `completed.finish_reason` 保留 Provider 的结束原因；`length` 表示达到输出 token 上限，调用方应将当前输出视为可能被截断。字段为可选且可空，以兼容未提供结束原因的模型服务。

## OpenAPI 与交互文档

FastAPI 的 `/docs`、`/redoc` 和 `/openapi.json` 直接展示由正式 YAML 契约生成的 `app/api/generated/openapi.json`，标题、版本、服务器、标签、安全方案、示例和错误响应不在应用代码中重复维护。修改契约后必须运行根目录的 `pnpm contracts:gen`。

文档开关由 `AI_DOCS_ENABLED` 控制：

- Development：示例配置为 `true`，文档可查看、可调用；
- Staging：示例配置为 `true`，并通过 `AI_SERVICE_PORT` 映射服务端口，文档可查看、可调用，但仍只应开放给内部开发和运维人员；
- Production：示例配置为 `false`，禁用 `/docs`、`/redoc` 和 `/openapi.json`；未显式配置时，`NODE_ENV=production` 也默认禁用文档。

Swagger 中执行 invoke 或 stream 会直接调用模型，应只使用非生产内部 Token 和测试数据。桌面端、移动端和第三方客户端必须调用 NestJS 公开 API，不得使用此内部文档作为客户端 API 入口。

## 环境与依赖

本地开发统一读取仓库根目录 `.env`；Staging 和 Production 由 Compose/平台注入环境变量。模型配置的相对路径始终以 `apps/ai-service` 为基准解析。

在本目录执行：

```powershell
uv sync --locked
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`pyproject.toml` 是依赖声明的唯一来源，`uv.lock` 必须提交。运行、CI 和容器使用同一 Python/uv 版本。

关键配置：

```text
NODE_ENV=development
AI_INTERNAL_TOKEN=change_me
AI_DOCS_ENABLED=true
AI_MODEL_CONFIG_PATH=config/models.toml
PRIMARY_LLM_API_KEY=change_me
BACKUP_LLM_API_KEY=change_me
```

`models.toml` 只保存非敏感 profile 与角色映射。API Key 通过 profile 的 `api_key_env` 从环境变量读取。生产环境不得将任何角色绑定到 Mock profile。

## 验证

```powershell
uv run ruff check app tests scripts
uv run pytest -q
```

契约验证与生成物漂移检查：

```powershell
pnpm contracts:lint
pnpm contracts:check
```

本地 FastAPI 文档：`http://localhost:8000/docs`。Staging 默认映射为 `http://<staging-host>:18000/docs`，可通过 `AI_SERVICE_PORT` 调整端口；部署网络应使用防火墙或 VPN 限制访问。

容器构建使用 ai-service 目录作为上下文：

```text
docker build -f apps/ai-service/Dockerfile apps/ai-service
```
