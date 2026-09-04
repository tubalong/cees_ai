# AI Enterprise Workbench

面向销售型中小企业的 AI 工作协同平台。仓库采用模块化单体业务后端，并将正式业务写入与 AI 建议生成严格分离。

## 服务职责

- `apps/api`：NestJS 企业业务事实源，负责认证、租户、权限、业务写入、统计和审计。
- `apps/ai-service`：FastAPI AI 建议服务，仅返回草稿、结构化提取与权限过滤后的 RAG 结果。
- `apps/desktop`：Electron 管理桌面端。
- `apps/mobile`：Flutter 一线员工移动端。
- `packages/*`：共享类型、API Client、UI、工程配置与 OpenAPI 文件。
- `infra`：PostgreSQL/pgvector、Redis 本地编排与腾讯云 COS 配置。

## 边界规则

- 三套工具链完全隔离：pnpm（api、desktop、packages）、Python（ai-service）、Flutter（mobile）。
- 跨语言只通过 `packages/contracts` 对齐；禁止任何一端 import 另一端的实现代码。
- NestJS 是业务数据唯一事实源；AI 服务只返回经 Schema 校验的草稿与建议，正式写入由 NestJS 执行。
- 客户端不复制服务端状态机，只消费契约与 API。
- 文件存储使用私有腾讯云 COS；长期 COS 凭据只允许注入 NestJS API。

## 快速启动

1. 将 `.env.example` 复制为 `.env`。
2. 替换所有 `change_me`，并核对腾讯云 COS 地域、Bucket、对象前缀与最小权限 CAM 凭据。
3. 安装 Node.js 20、pnpm 9、Docker Desktop；移动端开发另需 Flutter SDK。
4. 执行 `pnpm install`。
5. 执行 `pnpm infra:up`，启动本地 PostgreSQL/pgvector 与 Redis。
6. NestJS Swagger：`http://localhost:3000/api/docs`；FastAPI 文档：`http://localhost:8000/docs`。

测试环境使用 `.env.test` 与 `pnpm infra:test:up`；生产 Compose 环境使用 `.env.production` 与 `pnpm infra:prod:up`。具体组合见 [infra/README.md](infra/README.md)。

基础设施说明见 [infra/README.md](infra/README.md)；架构说明见 [docs/architecture/overview.md](docs/architecture/overview.md)；工程约定见 [AGENTS.md](AGENTS.md) 与 [docs](docs/README.md)。
