# CEES AI

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

## Node.js 与 pnpm（Windows）

1. 从 [Node.js 下载页](https://nodejs.org/en/download) 下载 Node.js 24 LTS 的 `Windows Installer (.msi)`（通常选择 x64）并完成安装。
2. 重新打开 PowerShell；若 Node.js 安装在 `Program Files` 且 `corepack enable pnpm` 报权限错误，请以管理员身份运行 PowerShell。执行：

   ```powershell
   corepack enable pnpm
   pnpm -v
   ```

   项目根目录的 `packageManager` 字段会将 pnpm 固定为 `12.3.4`。

## 快速启动

1. 本地开发将 `.env.example` 复制为 `.env`；应用服务器分别使用 `.env.staging.example` 和 `.env.production.example`；数据库服务器使用 `infra/database/` 下对应的环境示例。实际文件均不提交。
2. 安装 Node.js 24 LTS、pnpm 12.3.4、uv、Python 3.14 和 Docker Desktop；移动端开发另需 Flutter SDK。
3. 执行 `pnpm install --frozen-lockfile`。
4. 在 `apps/ai-service` 执行 `uv sync --locked`。
5. 本地执行 `pnpm infra:up`。
6. 数据库服务器通过 `scripts/package-database-bundle.ps1` 生成部署包，服务器解压后执行 `infra/database/deploy-db.sh`；不需要 clone 仓库。
7. Staging/Production 使用“本地构建镜像并上传 COS、服务器下载并导入镜像”的部署方式；应用服务器不需要 clone 完整仓库，也不执行依赖安装或镜像构建。

## 部署入口

按顺序执行的完整部署手册见 [infra/README.md](infra/README.md)：

1. 本地通过 `scripts/package-database-bundle.ps1` 生成数据库服务器部署包，上传解压后执行 `infra/database/deploy-db.sh`。
2. 本地通过 `scripts/publish-cos-release.ps1` 构建应用镜像并上传 COS。
3. 通过 `scripts/package-server-bundle.ps1` 生成应用服务器最小目录压缩包。
4. 应用服务器解压后通过 `infra/deploy-cos-release.sh` 下载、校验、导入并启动发布。

COS 权限和 COSCLI 参考见 [infra/tencent-cos/README.md](infra/tencent-cos/README.md)，数据库服务器部署见 [infra/database/README.md](infra/database/README.md)。

NestJS Swagger：`http://localhost:3000/api/docs`；FastAPI 文档本地为 `http://localhost:8000/docs`。Staging 在 `AI_SERVICE_PORT`（默认 `8000`）对外提供 `/docs`，Production 不映射 ai-service 宿主机端口。

架构说明见 [docs/architecture/overview.md](docs/architecture/overview.md)，AI 基础设施说明见 [docs/architecture/ai-service-foundation.md](docs/architecture/ai-service-foundation.md)。
