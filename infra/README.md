# 基础设施

仓库只保留三套部署环境：本地开发、共享测试服务器（Staging）和生产服务器。自动化测试由 CI 直接注入变量，不再维护第四套部署环境文件或 Compose 覆盖。

## Compose 文件

| 文件 | 作用 |
| --- | --- |
| `docker-compose.yml` | PostgreSQL、Redis 公共定义 |
| `docker-compose.dev.yml` | 本地端口和本地持久化卷 |
| `docker-compose.deploy.yml` | API、ai-service、迁移任务和内部健康检查 |
| `docker-compose.staging.yml` | Staging 持久化卷、重启策略和 API 暴露端口 |
| `docker-compose.prod.yml` | Production 持久化卷、重启策略和 API 暴露端口 |

## 环境对应关系

| 环境 | 环境文件 | Compose 组合 | 运行方式 |
| --- | --- | --- | --- |
| 本地开发 | `.env` | base + dev | Docker 只运行 PostgreSQL/Redis；API 和 ai-service 在宿主机运行 |
| Staging | `.env.staging` | base + deploy + staging | 完整容器化部署，使用持久化非生产数据 |
| Production | `.env.production` | base + deploy + prod | 完整容器化部署，使用生产数据和 Secrets |

实际 `.env` 文件不提交。仓库只提交 `.env.example`、`.env.staging.example` 和 `.env.production.example`。

## Linux 服务器部署脚本

服务器可以使用仓库内的 `scripts/compose-deploy.sh` 直接管理 Staging 和 Production，不需要为了运行部署入口额外安装 Node.js 或 pnpm。脚本始终从仓库根目录解析 Compose 文件，并在启动前验证 Docker Compose、环境文件、`change_me` 占位符和 AI 模型配置文件。

```bash
# 首次使用可以显式通过 Bash 执行，不依赖 Git 可执行位
bash scripts/compose-deploy.sh production validate
bash scripts/compose-deploy.sh production

# 常用运维命令
bash scripts/compose-deploy.sh production ps
bash scripts/compose-deploy.sh production logs
bash scripts/compose-deploy.sh production logs api
bash scripts/compose-deploy.sh production down
```

第一个参数可使用 `staging`、`production` 或 `prod`；第二个参数支持 `up`、`down`、`logs`、`ps` 和 `validate`，省略时默认为 `up`。`up` 会验证配置并使用 `--build` 构建当前检出的源码；脚本不会自动执行 `git pull`，也不会使用 `down -v` 删除数据卷。

在 Linux 上赋予可执行权限后，也可以省略 `bash`：

```bash
chmod +x scripts/compose-deploy.sh
./scripts/compose-deploy.sh production
```

Secret 仍只保存在未提交的 `.env.staging`、`.env.production` 或平台 Secret 管理器中，不得写入部署脚本。生产发布前应明确检出目标 commit/tag，并完成数据库备份。

## 本地开发

```powershell
Copy-Item .env.example .env
pnpm infra:up
```

查看和关闭：

```powershell
pnpm infra:logs
pnpm infra:down
```

本地 PostgreSQL 和 Redis 从宿主机通过 `.env` 中的端口访问。API 与 ai-service 使用本地进程启动，以保留热更新和调试能力。

## Staging

首次在测试服务器准备配置：

```powershell
Copy-Item .env.staging.example .env.staging
Copy-Item apps/ai-service/config/models.staging.example.toml apps/ai-service/config/models.staging.toml
```

必须替换所有 `change_me`，并确保：

- Staging 使用独立 PostgreSQL、Redis、COS 前缀和模型 Key；
- `NODE_ENV=production`，以验证生产安全约束；
- 模型配置不绑定 Mock；
- `AI_MODEL_CONFIG_HOST_PATH` 指向服务器上的实际模型 TOML；
- 只公开 API 端口，ai-service 仅在 Compose 网络内暴露。

启动：

```powershell
pnpm infra:staging:up
```

Linux 测试服务器也可以直接使用部署脚本：

```bash
bash scripts/compose-deploy.sh staging
```

上述入口会构建 API/ai-service 镜像、启动 PostgreSQL/Redis、执行 `prisma migrate deploy`，等待 ai-service readiness 后启动 API。

日志和关闭：

```powershell
pnpm infra:staging:logs
pnpm infra:staging:down
```

## Production

生产服务器从 `.env.production.example` 创建部署配置，并以 `apps/ai-service/config/models.production.example.toml` 为生产模型配置模板；真实 Secret 应优先由平台 Secret 管理器注入：

```powershell
pnpm infra:prod:up
pnpm infra:prod:logs
pnpm infra:prod:down
```

Linux 生产服务器推荐使用部署脚本，确保根据当前检出的源码重新构建镜像：

```bash
bash scripts/compose-deploy.sh production validate
bash scripts/compose-deploy.sh production
bash scripts/compose-deploy.sh production logs
```

生产模型配置默认从 `/opt/cees/config/ai-models.production.toml` 挂载到 ai-service 的 `/run/config/ai-models.toml`。Production 与 Staging 不得共享数据库、Redis、COS 前缀、JWT Secret、内部 Token 或模型 API Key。

## 网络与迁移

- 本地宿主机地址使用 `localhost`。
- Staging/Production 容器内部使用 `postgres`、`redis`、`ai-service` 服务名。
- `migrate` 是一次性服务；迁移成功后 API 才启动。
- PostgreSQL/Redis 不在 Staging/Production 暴露宿主机端口。
- ai-service 不暴露宿主机端口，只允许 API 通过内部网络访问。

腾讯云 COS 不在 Compose 中启动，配置与最小权限策略见 [tencent-cos/README.md](tencent-cos/README.md)。
