# AI Enterprise Workbench

企业协同应用仓库。NestJS 负责业务事实与审计，FastAPI ai-service 只提供与具体业务无关的 AI 运行时基础设施。

## 服务职责

- `apps/api`：认证、租户、权限、正式业务写入和审计。
- `apps/ai-service`：多模型配置、LangChain 调用、LangGraph/LlamaIndex 集成基础和内部 invoke。
- `apps/desktop`：Electron + React 桌面端。
- `apps/mobile`：Flutter 移动端。
- `packages/contracts`：公开 API 与 ai-service 内部 OpenAPI 契约。
- `packages/ai-service-client`：由内部契约生成的 TypeScript SDK。
- `infra`：PostgreSQL、Redis 和腾讯云 COS 配置。

## 边界规则

- pnpm、Python/uv 和 Flutter 三套工具链相互独立。
- 跨语言只通过 `packages/contracts` 对齐；生成客户端禁止手改。
- NestJS 是业务数据唯一事实源；ai-service 不直接连接业务数据库或写入正式业务数据。
- 通用 `/internal/v1/llm/invoke` 只允许 NestJS 使用，不向客户端公开。
- 桌面端和移动端中的部分菜单仍为 UI 原型，不代表后端已有对应能力。
- Secret 只通过环境变量或平台 Secrets 注入。

## 快速启动

1. 本地开发将 `.env.example` 复制为 `.env`；共享测试服务器使用 `.env.staging.example`；生产服务器使用 `.env.production.example`。实际文件均不提交。
2. 安装 Node.js 22、pnpm 9.15、uv、Python 3.14 和 Docker Desktop；移动端开发另需 Flutter SDK。
3. 执行 `pnpm install --frozen-lockfile`。
4. 在 `apps/ai-service` 执行 `uv sync --locked`。
5. 本地执行 `pnpm infra:up`；Staging 执行 `pnpm infra:staging:up`；Production 执行 `pnpm infra:prod:up`。
6. 本地分别启动 NestJS 和 ai-service；Staging/Production 由 Compose 启动完整服务。

NestJS Swagger：`http://localhost:3000/api/docs`；FastAPI 文档：`http://localhost:8000/docs`。

架构说明见 [docs/architecture/overview.md](docs/architecture/overview.md)，AI 基础设施说明见 [docs/architecture/ai-service-foundation.md](docs/architecture/ai-service-foundation.md)。
