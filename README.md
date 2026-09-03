# CEES AI

企业级 AI 协同工作平台 monorepo（工程骨架）。

## 技术栈与仓库布局

| 目录 | 职责 | 工具链 |
| --- | --- | --- |
| `apps/api` | NestJS 业务事实源：认证、租户、RBAC、业务写入、统计、审计 | pnpm / TypeScript |
| `apps/ai-service` | Python FastAPI AI 服务：草稿、建议、RAG，不直接写业务数据 | uv / pip / Python |
| `apps/desktop` | Electron + React 桌面端 | pnpm / TypeScript |
| `apps/mobile` | Flutter 移动端 | pub / Dart |
| `packages/contracts` | OpenAPI 契约：全仓唯一跨语言桥 | 纯 YAML |
| `packages/*` | TS 共享包：api-client、ui-kit、config | pnpm / TypeScript |
| `infra` | 本地基础设施编排（PostgreSQL/pgvector、Redis、MinIO） | Docker Compose |
| `docs` | 架构、API、数据库、安全、产品文档 | Markdown |

## 边界规则

- 三套工具链完全隔离：pnpm（api、desktop、packages）、Python（ai-service）、Flutter（mobile）。
- 跨语言只通过 `packages/contracts` 对齐；禁止任何一端 import 另一端的实现代码。
- NestJS 是业务数据唯一事实源；AI 服务只返回经 Schema 校验的草稿与建议，正式写入由 NestJS 执行。
- 客户端不复制服务端状态机，只消费契约与 API。

## 快速启动（骨架就绪后）

1. `Copy-Item .env.example .env`，把 `change_me` 全部替换。
2. `pnpm install`
3. `pnpm infra:up` 启动依赖服务。
4. NestJS Swagger：`http://localhost:3000/api/docs`；FastAPI 文档：`http://localhost:8000/docs`。

详细约定见 [AGENTS.md](AGENTS.md) 与 [docs](docs/README.md)。
