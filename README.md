# AI Enterprise Workbench

面向销售型中小企业的 AI 工作协同平台。仓库采用模块化单体业务后端，并将正式业务写入与 AI 建议生成严格分离。

## 服务职责

- `apps/api`：NestJS 企业业务事实源，负责认证、租户、权限、业务写入、统计和审计。
- `apps/ai-service`：FastAPI AI 建议服务，仅返回草稿、结构化提取与权限过滤后的 RAG 结果。
- `apps/desktop`：Electron 管理桌面端。
- `apps/mobile`：Flutter 一线员工移动端。
- `packages/*`：共享类型、API Client、UI、工程配置与 OpenAPI 文件。
- `infra`：PostgreSQL/pgvector、Redis、MinIO 与本地容器编排。

## 快速启动

1. 将 `.env.example` 复制为 `.env`，修改所有 `change_me` 值。
2. 安装 Node.js 20、pnpm 9、Docker Desktop；移动端开发另需 Flutter SDK。
3. 执行 `pnpm install`。
4. 执行 `pnpm infra:up`。
5. NestJS Swagger：`http://localhost:3000/api/docs`。
6. FastAPI 文档：`http://localhost:8000/docs`。
7. MinIO Console：`http://localhost:9001`。

详见 [架构说明](docs/architecture/overview.md)。