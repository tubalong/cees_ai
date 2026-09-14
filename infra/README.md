# CEES AI 部署

本文只说明端口、最终目录，以及数据库服务器和应用服务器的打包、部署流程；不包含产物上传到服务器的步骤。COSCLI 与权限配置见 [腾讯云 COS 配置](tencent-cos/README.md)。

服务器不编译源码，也不需要 clone 仓库。数据库使用独立部署包；应用使用服务器目录包，并从 COS 下载预先构建的 Docker 镜像。

## 1. 端口

Staging 与 Production 部署在不同服务器或服务器组，均使用标准端口。

| 服务 | 容器端口 | 宿主机端口 | 说明 |
| --- | ---: | ---: | --- |
| API | `3000` | `3000` | Staging、Production 均映射 |
| ai-service | `8000` | `8000` | 仅 Staging 映射；Production 只在 Compose 内部访问 |
| PostgreSQL/pgvector | `5432` | `5432` | 绑定数据库服务器私网 IP |
| Redis | `6379` | `6379` | 绑定数据库服务器私网 IP |

应用的 `DATABASE_URL` 和 `REDIS_URL` 必须使用数据库服务器私网地址。

## 2. 最终目录结构

```text
/opt/
├── cees-db/
│   ├── .env.staging 或 .env.production
│   ├── docker-compose.yml
│   ├── docker-compose.server.yml
│   ├── deploy-db.sh
│   ├── manage-db.sh
│   ├── DEPLOY.md
│   ├── bundle-manifest.json
│   └── images/database-images.tar    # 仅 -IncludeImages 包含
└── cees-ai/
    ├── .env.staging 或 .env.production
    ├── config/models.staging.toml 或 models.production.toml
    ├── infra/
    │   ├── deploy-cos-release.sh
    │   ├── manage-app.sh
    │   ├── docker-compose.deploy.yml
    │   └── docker-compose.staging.yml 或 docker-compose.production.yml
    ├── DEPLOY.md
    ├── bundle-manifest.json
    └── .release-cache/                # 首次部署后生成
```

应用服务器一次只部署一个环境，应用运行目录统一为 `/opt/cees-ai/`；数据库运行目录为 `/opt/cees-db/`。

## 3. 数据库服务器

数据库服务器需要 Docker 和 Docker Compose v2，并且必须先于应用部署。

### 3.1 打包

在仓库根目录执行：

```powershell
pwsh ./scripts/package-database-bundle.ps1 -Environment staging
pwsh ./scripts/package-database-bundle.ps1 -Environment production
```

默认包不含 Docker 镜像；数据库服务器无法访问镜像仓库时增加 `-IncludeImages`：

```powershell
pwsh ./scripts/package-database-bundle.ps1 -Environment production -IncludeImages
```

脚本优先使用 `infra/database/.env.<environment>`，不存在时回退到 example。每次打包前会清空对应环境子目录，只保留本次结果：

```text
dist/database-bundles/<staging|production>/
├── cees-ai-db-<environment>-<timestamp>-<git-sha>.tar.gz
└── cees-ai-db-<environment>-<timestamp>-<git-sha>.tar.gz.sha256
```

### 3.2 部署

部署包到达数据库服务器后执行：

```bash
sha256sum -c cees-ai-db-<environment>-<timestamp>-<git-sha>.tar.gz.sha256
sudo mkdir -p /opt
sudo tar -xzf cees-ai-db-<environment>-<timestamp>-<git-sha>.tar.gz -C /opt
cd /opt/cees-db

chmod 600 .env.staging       # Production 使用 .env.production
bash deploy-db.sh staging    # Production 使用 production
```

部署前必须清除环境文件中的 `change_me`。`deploy-db.sh` 会优先加载包内离线镜像；没有离线镜像时拉取 PostgreSQL/pgvector 和 Redis 镜像，然后启动服务。数据库服务器只负责基础设施；业务表迁移和平台超级管理员初始化由随后部署的 API 镜像执行。

```bash
bash manage-db.sh staging ps       # 查看状态
bash manage-db.sh staging logs     # 查看日志
```

## 4. 应用服务器

应用发布包含两个产物：应用 Docker 镜像发布包和应用服务器目录包。应用服务器需要 Docker、Docker Compose v2、COSCLI 和 `sha256sum`。

### 4.1 构建并发布应用镜像

Staging：

```powershell
pwsh ./scripts/publish-cos-release.ps1 `
  -Environment staging `
  -UseChinaImageMirror `
  -CosAlias cees-release
```

Production 使用已在 Staging 验证通过的同一 `release-id`，且工作区必须干净：

```powershell
pwsh ./scripts/publish-cos-release.ps1 `
  -Environment production `
  -ReleaseId <staging-release-id> `
  -UseChinaImageMirror `
  -CosAlias cees-release
```

`-UseChinaImageMirror` 是可选参数，用于构建机无法稳定访问 Docker Hub 或 GHCR 时，将 Node、Python 和 uv 基础镜像切换到 DaoCloud 公共镜像。它只替换基础镜像地址，不配置 HTTP 代理，也不修改 `pnpm-lock.yaml` 或 `uv.lock`；显式传入 `-NodeBaseImage`、`-PythonBaseImage` 或 `-UvBaseImage` 时，以显式值为准。

构建前会清空本地对应环境子目录；本地产物位于 `dist/releases/<staging|production>/<release-id>/`，只保留本次构建。COS 发布渠道为 `releases/<staging|production>/`。

### 4.2 打包应用服务器目录

```powershell
pwsh ./scripts/package-server-bundle.ps1 -Environment staging
pwsh ./scripts/package-server-bundle.ps1 -Environment production
```

脚本优先使用真实的 `.env.<environment>` 和 `models.<environment>.toml`，缺失时回退到 example。每次打包前会清空对应环境子目录，只保留本次结果：

```text
dist/server-bundles/<staging|production>/
├── cees-ai-<environment>-server-<timestamp>-<git-sha>.tar.gz
└── cees-ai-<environment>-server-<timestamp>-<git-sha>.tar.gz.sha256
```

### 4.3 部署

目录包到达应用服务器后，按环境替换命令中的占位符：

```bash
sha256sum -c cees-ai-<environment>-server-<timestamp>-<git-sha>.tar.gz.sha256
sudo mkdir -p /opt
sudo tar -xzf cees-ai-<environment>-server-<timestamp>-<git-sha>.tar.gz -C /opt
cd /opt/cees-ai

chmod 600 .env.<environment> config/models.<environment>.toml
bash infra/deploy-cos-release.sh <environment> <release-reference>
```

参数对应关系：

| 环境 | `<environment>` | `<release-reference>` |
| --- | --- | --- |
| Staging | `staging` | `latest` 或明确的 `release-id` |
| Production | `production` | 已在 Staging 验证的明确 `release-id`，不要使用 `latest` |

部署前必须清除环境文件和模型配置中的 `change_me`，并填写 `SEED_PLATFORM_ADMIN_ACCOUNT`、`SEED_PLATFORM_ADMIN_PASSWORD`、`SEED_PLATFORM_ADMIN_DISPLAY_NAME`。`deploy-cos-release.sh` 会从 COS 下载并校验镜像包、导入镜像和更新镜像标签；Compose 随后执行 Prisma migration、创建缺失的平台超级管理员，再启动 ai-service 和 API。平台初始化不会创建默认租户或租户管理员，同名平台账号已存在时也不会覆盖现有凭证或状态。

ai-service 只接收 `docker-compose.deploy.yml` 中显式声明的环境变量。模型配置里每个已启用 profile 的 `api_key_env` 都必须在 `.env.<environment>` 中提供非空值，并由 Compose 透传；当前透传 `PRIMARY_LLM_API_KEY`、`BACKUP_LLM_API_KEY`、`VISION_LLM_API_KEY`、`IMAGE_GEN_API_KEY` 和 `IMAGE_GEN_BACKUP_API_KEY`。新增已启用 profile、启用带 `vision` capability 的 profile 或改用新的 `api_key_env` 名称时，必须同时修改模型配置、环境文件和 `docker-compose.deploy.yml`，否则 ai-service 的 `/ready` 返回 503，容器被判定为 unhealthy，`api` 因 `depends_on: service_healthy` 无法启动。

服务器目录结构不变时，日常发布无需重新打目录包，只需发布新镜像并再次执行 `deploy-cos-release.sh`。

```bash
bash infra/manage-app.sh <staging|production> ps
bash infra/manage-app.sh <staging|production> logs
```

### 4.4 ai-service 未就绪排查

`manage-app.sh up` 失败时会打印未通过健康检查的容器及其最后一次健康检查输出，随后可用日志查看完整原因：

```bash
bash infra/manage-app.sh <staging|production> logs ai-service
```

ai-service 在启动时会把 `/ready` 的全部未就绪原因写入容器日志；镜像早于该日志能力时，可读取健康检查的响应体，healthcheck 会打印 `/ready` 的响应：

```bash
docker inspect --format '{{json .State.Health.Log}}' <container>
```

`/ready` 返回 503 的常见原因：

- 模型配置缺少 `[chat]`、`[chat.modes.standard]` 或 `[chat.modes.ultra]`；
- 缺少 `[image_profiles.*]`，或没有任何 `enabled = true` 的图片 profile；
- `roles` 缺少必要角色（尤其是 `orchestrator`）、引用了未启用 profile，或该 profile 缺少 `tool_calling` capability；
- 生产环境仍启用 Mock profile，或模型、Base URL、API Key 仍是 `change_me` 占位值；
- 已启用 profile 的 `api_key_env` 在容器内为空，即环境文件未填写或 Compose 未透传。

> `.env`、模型配置、COSCLI 配置和各类密钥不得提交到 Git 或放入 COS 镜像发布包。服务器目录包若包含真实配置，应按 Secret 文件处理。
