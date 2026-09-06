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

正式契约位于 `packages/contracts/openapi/ai-service.openapi.yaml`。业务客户端不得直接调用通用 invoke，必须由 NestJS 统一认证、审计和编排。

## 环境与依赖

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
AI_MODEL_CONFIG_PATH=config/models.toml
PRIMARY_LLM_API_KEY=change_me
BACKUP_LLM_API_KEY=change_me
```

`models.toml` 只保存非敏感 profile 与角色映射。API Key 通过 profile 的 `api_key_env` 从环境变量读取。生产环境不得将任何角色绑定到 Mock profile。

## 验证

```powershell
uv run ruff check app tests
uv run pytest -q
```

FastAPI 文档：`http://localhost:8000/docs`。

容器构建使用 ai-service 目录作为上下文：

```text
docker build -f apps/ai-service/Dockerfile apps/ai-service
```
