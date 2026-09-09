# CEES AI 部署手册

本文档是 CEES AI 部署的主入口。日常发布按本文档顺序执行；COS 权限与 COSCLI 细节见 [腾讯云 COS 配置](tencent-cos/README.md)，数据库服务器细节见 [数据库服务器部署](database/README.md)。

## 1. 当前部署方式

应用服务器和数据库服务器都不构建源码，也不需要 clone 完整仓库。部署流程使用三个独立产物：

1. **应用镜像发布包**：开发电脑构建 `cees-api` 和 `cees-ai-service`，上传到 COS 的 `releases/staging` 或 `releases/prod`。
2. **应用服务器目录包**：包含应用 Compose、部署脚本、环境文件和模型配置；上传服务器后解压到 `/opt/cees-ai/`。
3. **数据库服务器部署包**：包含 PostgreSQL/Redis Compose、环境文件和一键部署脚本；上传服务器后解压到 `/opt/cees-db/`。

```text
开发电脑
├── publish-cos-release.ps1
│   └── 应用 Docker 镜像包 -> COS releases/{staging|prod}/...
├── package-server-bundle.ps1
│   └── 应用服务器最小目录 -> tar.gz
└── package-database-bundle.ps1
    └── 数据库服务器部署目录 -> tar.gz（默认不含离线镜像）

应用服务器
└── deploy-cos-release.sh
    ├── 从 COS 下载并校验应用镜像包
    ├── docker image load
    ├── 更新 IMAGE_TAG
    ├── prisma migrate deploy
    └── 启动 ai-service 和 API

数据库服务器
└── deploy-db.sh
    ├── 有离线镜像则 docker image load
    ├── 缺少镜像则 docker pull
    └── 启动 PostgreSQL/pgvector 和 Redis
```

应用服务器不会访问 npm、PyPI、Docker Hub 或 GHCR。`manage-app.sh` 使用 `--no-build --pull never`，只允许启动已经导入的本地应用镜像。数据库部署包默认不包含离线镜像，数据库服务器在没有本地镜像包时从镜像仓库拉取。

## 2. 部署拓扑

Staging 与 Production 部署在不同服务器或不同服务器组，不共享宿主机端口。因此两个环境统一使用服务默认端口，不再使用环境专属的偏移端口。

| 服务 | 容器端口 | 宿主机端口 |
| --- | ---: | ---: |
| cees-api | `3000` | `3000` |
| ai-service（Staging 对外） | `8000` | `8000` |
| PostgreSQL/pgvector | `5432` | `5432` |
| Redis | `6379` | `6379` |

Production 的 ai-service 仍只监听 Compose 内部端口 `8000`，不映射宿主机端口。

每个环境使用自己的运行目录：

```text
Staging 服务器:    /opt/cees-ai/staging/
Production 服务器: /opt/cees-ai/production/
数据库部署单元:     /opt/cees-db/
```

数据库必须先按 [database/README.md](database/README.md) 启动。应用连接串使用对应环境数据库主机的私网地址和标准端口 `5432`/`6379`，不得使用数据库主机公网 IP。

## 3. 一次性准备

### 3.1 开发电脑

需要：

- PowerShell 7；
- Docker Desktop 与 Docker Buildx；
- COSCLI；
- 发布子用户的 COSCLI 配置，Bucket 别名为 `cees-release`。

COSCLI 初始化和 CAM 权限见 [腾讯云 COS 配置](tencent-cos/README.md#2-发布子用户权限)。

### 3.2 应用服务器

需要：

- Docker；
- Docker Compose v2；
- `sha256sum`；
- COSCLI；
- `.env.staging`/`.env.production`；
- 对应的 `config/models.*.toml`。

Linux AMD64 安装 COSCLI：

```bash
curl -fL \
  https://cosbrowser.cloud.tencent.com/software/coscli/coscli-linux-amd64 \
  -o /tmp/coscli
install -m 0755 /tmp/coscli /usr/local/bin/coscli
coscli --version
```

在服务器当前部署用户下初始化 COSCLI：

```bash
coscli config init --disable-log
chmod 600 "$HOME/.cos.yaml"
```

填写：

```text
Bucket Name: cees-ai-1403013862
Endpoint: cos.ap-chengdu.myqcloud.com
Alias: cees-release
```

### 3.3 数据库服务器

需要：

- Docker；
- Docker Compose v2；
- `sha256sum`；
- 默认轻量包部署时能够访问 `pgvector/pgvector` 和 `redis` 镜像仓库，或者改用带 `-IncludeImages` 的离线包。

## 4. 数据库服务器打包与部署

数据库必须先于应用启动。完整参数、离线镜像规则和日常管理命令见 [数据库服务器部署包](database/README.md)。

### 步骤 1：本地生成轻量部署包

默认不下载或打包 Docker 镜像，也不要求打包过程访问镜像仓库：

```powershell
pwsh ./scripts/package-database-bundle.ps1 -Environment staging
```

Production 将环境替换为 `production`。脚本优先使用 `infra/database/.env.<environment>`，不存在时回退到 example。输出位于：

```text
dist/database-bundles/
├── cees-ai-db-<environment>-<timestamp>-<git-sha>.tar.gz
└── cees-ai-db-<environment>-<timestamp>-<git-sha>.tar.gz.sha256
```

只有数据库服务器不能访问镜像仓库时，才显式包含离线镜像：

```powershell
pwsh ./scripts/package-database-bundle.ps1 `
  -Environment staging `
  -IncludeImages
```

### 步骤 2：上传、校验和解压

```powershell
scp ./dist/database-bundles/<压缩包>.tar.gz `
  ./dist/database-bundles/<压缩包>.tar.gz.sha256 `
  root@<database-server>:/tmp/
```

```bash
cd /tmp
sha256sum -c <压缩包>.tar.gz.sha256
mkdir -p /opt
tar -xzf <压缩包>.tar.gz -C /opt
cd /opt/cees-db
chmod 600 .env.staging
```

如果是模板包，先填写 `.env.staging` 并确保不含 `change_me`。Production 使用 `.env.production`。

### 步骤 3：一键部署

```bash
cd /opt/cees-db
bash deploy-db.sh staging
```

部署脚本检查当前目录及 `images/` 子目录：有 `*.tar`、`*.tar.gz`、`*.tgz` 时先加载离线镜像，本地仍缺少的 Compose 镜像才拉取；完全没有离线镜像时执行 `docker compose pull`。镜像准备完成后以 `--pull never` 启动数据库服务。

确认 PostgreSQL 和 Redis 健康后，再继续部署应用服务器。

## 5. 第一次部署 Staging

### 步骤 1：本地构建并上传应用镜像

国内网络建议显式启用基础镜像加速：

```powershell
Set-Location D:\Repos\cees_ai

pwsh ./scripts/publish-cos-release.ps1 `
  -Environment staging `
  -UseChinaImageMirror `
  -CosAlias cees-release `
  -CosConfigPath "$HOME/.config/cees/cos-release.yaml"
```

如果工作区存在未提交修改，只允许 Staging 显式使用：

```powershell
-AllowDirty
```

记录脚本输出的 `Release ID`。发布对象位于：

```text
releases/staging/<release-id>/
```

### 步骤 2：生成服务器目录压缩包

直接执行：

```powershell
pwsh ./scripts/package-server-bundle.ps1 -Environment staging
```

脚本会自动选择配置：

1. 如果根目录存在 `.env.staging`，直接打包；否则使用 `.env.staging.example`。
2. 如果存在 `apps/ai-service/config/models.staging.toml`，直接打包；否则继续检查 `config/models.staging.toml` 和根目录 `models.staging.toml`，最后才回退到 `models.staging.example.toml`。
3. 无论源文件中的路径是什么，压缩包内都会统一写成 `AI_MODEL_CONFIG_HOST_PATH=../config/models.staging.toml`。

脚本输出会显示实际选择的 `Env source`、`Model source` 和 `Mode`：

- `Mode: ready`：没有 `change_me`，可以作为完整运行配置包使用。
- `Mode: template`：仍有占位值，解压后必须先编辑。

输出目录：

```text
dist/server-bundles/
├── cees-ai-staging-server-<timestamp>-<git-sha>.tar.gz
└── cees-ai-staging-server-<timestamp>-<git-sha>.tar.gz.sha256
```

文件名中的 `<timestamp>` 使用执行打包脚本时操作系统的当前时区时间，格式为 `yyyyMMddTHHmmss`，不再使用 UTC `Z` 后缀。`bundle-manifest.json` 同时记录本地时间、UTC 时间和系统时区 ID。

需要覆盖自动选择结果时，仍可显式指定：

```powershell
pwsh ./scripts/package-server-bundle.ps1 `
  -Environment staging `
  -EnvironmentFile <环境文件路径> `
  -ModelConfigFile <模型配置路径>
```

只要打包了真实 `.env`，压缩包就可能包含数据库密码、JWT Secret 和 API Key，必须通过受控通道传输，上传后删除不必要的副本。

服务器目录包解压后包含：

```text
staging/
├── .env.staging
├── DEPLOY.md
├── bundle-manifest.json
├── config/
│   └── models.staging.toml
└── infra/
    ├── deploy-cos-release.sh
    ├── manage-app.sh
    ├── docker-compose.deploy.yml
    └── docker-compose.staging.yml
```

### 步骤 3：上传并解压服务器目录包

将打包脚本输出的 `Archive` 和 `Checksum` 两个文件上传：

```powershell
scp ./dist/server-bundles/<压缩包文件名>.tar.gz `
  ./dist/server-bundles/<压缩包文件名>.tar.gz.sha256 `
  root@<app-server>:/tmp/
```

服务器先校验再解压：

```bash
cd /tmp
sha256sum -c <压缩包文件名>.tar.gz.sha256
mkdir -p /opt/cees-ai
tar -xzf <压缩包文件名>.tar.gz -C /opt/cees-ai
cd /opt/cees-ai/staging
```

模板包需要编辑：

```bash
nano .env.staging
nano config/models.staging.toml
```

确认没有占位值：

```bash
if grep -R "change_me" .env.staging config/models.staging.toml; then
  echo "仍有 change_me，禁止部署"
  exit 1
fi
```

限制权限：

```bash
chmod 600 .env.staging config/models.staging.toml "$HOME/.cos.yaml"
```

### 步骤 4：从 COS 部署

部署 `latest.json` 指向的最近一次完整 Staging 发布：

```bash
bash infra/deploy-cos-release.sh staging latest
```

也可以使用步骤 1 输出的明确版本：

```bash
bash infra/deploy-cos-release.sh staging <release-id>
```

脚本会自动下载、校验、导入镜像、更新 `.env.staging` 的镜像标签并启动服务。

### 步骤 5：访问 Staging ai-service 文档

Staging 将 ai-service 的容器端口 `8000` 映射到宿主机 `AI_SERVICE_PORT`，默认端口为 `8000`：

```text
http://<应用服务器地址>:8000/docs
```

若修改端口，在 `.env.staging` 设置：

```env
AI_SERVICE_PORT=8000
```

Production 不提供该端口。Staging 对外开放时，应在云安全组或主机防火墙中限制允许访问的来源 IP；模型调用接口仍由 `AI_INTERNAL_TOKEN` 保护。

### 步骤 6：检查状态

```bash
bash infra/manage-app.sh staging ps
bash infra/manage-app.sh staging logs api
bash infra/manage-app.sh staging logs ai-service
```

## 6. 日常 Staging 发布

服务器目录已经存在且 `infra/` 没有变化时，不需要重复生成或上传服务器目录包。

1. 本地重新执行 `publish-cos-release.ps1` 上传新镜像发布。
2. 服务器执行：

```bash
cd /opt/cees-ai/staging
bash infra/deploy-cos-release.sh staging latest
```

只有 Compose、部署脚本、环境模板或模型配置结构变化时，才重新生成并解压服务器目录包。

## 7. Production 发布

Production 必须来自干净 Git 工作区，并使用已经在 Staging 验证通过的明确 `release-id`。

### 步骤 1：将同一 Release ID 发布到 prod 前缀

```powershell
pwsh ./scripts/publish-cos-release.ps1 `
  -Environment prod `
  -ReleaseId <staging-release-id> `
  -UseChinaImageMirror `
  -CosAlias cees-release `
  -CosConfigPath "$HOME/.config/cees/cos-release.yaml"
```

### 步骤 2：首次生成并上传 Production 服务器目录包

```powershell
pwsh ./scripts/package-server-bundle.ps1 -Environment production
```

Production 使用同样的自动选择规则：优先 `.env.production` 和现成的 `models.production.toml`，缺失时才回退到 example。确认脚本输出的 `Mode`；只有 `template` 包需要在服务器继续填写占位值。

解压到：

```text
/opt/cees-ai/production/
```

如果包为 `template`，填写 `.env.production` 和 `config/models.production.toml`；无论模式如何，部署前都应确认不包含 `change_me`。

### 步骤 3：部署明确版本

```bash
cd /opt/cees-ai/production
bash infra/deploy-cos-release.sh production <staging-release-id>
```

Production 不应直接部署可变的 `latest`。

## 8. 常用运维命令

```bash
# 校验配置
bash infra/manage-app.sh staging validate
bash infra/manage-app.sh production validate

# 状态
bash infra/manage-app.sh staging ps
bash infra/manage-app.sh production ps

# 日志
bash infra/manage-app.sh staging logs
bash infra/manage-app.sh staging logs api
bash infra/manage-app.sh staging logs ai-service
bash infra/manage-app.sh staging logs migrate

# 停止，不删除数据卷
bash infra/manage-app.sh staging down
bash infra/manage-app.sh production down
```

### ai-service 显示 unhealthy

先读取 `/ready` 的结构化错误，不要只看 Uvicorn 的 503 日志：

```bash
docker exec cees-ai-staging-ai-service-1 \
  python -c "import http.client; c=http.client.HTTPConnection('localhost',8000,timeout=3); c.request('GET','/ready'); r=c.getresponse(); print(r.status); print(r.read().decode())"
```

如果模型配置中启用了某个 profile，其 `api_key_env` 对应变量必须在 `.env.staging`/`.env.production` 中存在且非空。禁用 profile 时，还必须把它从所有 `[roles]` 候选列表中移除。修改 `.env` 后需要重新创建容器；只修改挂载的模型 TOML 后至少需要重启 ai-service。

## 9. 发布包校验与缓存

服务器下载缓存默认位于：

```text
/opt/cees-ai/staging/.release-cache/
/opt/cees-ai/production/.release-cache/
```

`deploy-cos-release.sh` 会校验：

- `latest.json`/指定 `release-id`；
- `manifest.json` 完整发布标记；
- manifest、`release.env` 和环境一致性；
- `SHA256SUMS`；
- 导入后的两个 Docker 镜像标签。

旧镜像和缓存默认保留。可以重新部署旧 `release-id`，但数据库 migration 可能不可逆，不能仅通过切换旧镜像假定数据库可以安全回滚。

## 10. Secret 与文件边界

不得上传到 COS 镜像发布包或提交到 Git：

- `.env.staging`、`.env.production`；
- `models.staging.toml`、`models.production.toml`；
- COSCLI 配置；
- JWT、数据库、Redis、COS 和模型 API Key。

服务器目录打包脚本会自动优先使用现有 `.env.staging`/`.env.production` 和环境模型配置；只要自动或显式包含了真实运行配置，该压缩包都必须按 Secret 处理。

## 11. 文件入口

| 文件 | 用途 |
| --- | --- |
| `scripts/publish-cos-release.ps1` | 本地构建应用镜像并上传 COS |
| `scripts/package-server-bundle.ps1` | 本地生成应用服务器最小目录压缩包 |
| `scripts/package-database-bundle.ps1` | 本地生成数据库服务器部署包，默认不含离线镜像 |
| `infra/deploy-cos-release.sh` | 应用服务器下载、校验、导入并部署发布 |
| `infra/manage-app.sh` | 应用服务器启停、日志和状态 |
| `infra/database/deploy-db.sh` | 数据库服务器准备本地/远程镜像并一键部署 |
| `infra/database/manage-db.sh` | 数据库服务器日常启停、日志和状态 |
| `infra/docker-compose.deploy.yml` | 应用运行公共定义，不包含 build |
| `infra/docker-compose.staging.yml` | Staging 端口和重启策略 |
| `infra/docker-compose.prod.yml` | Production 端口和重启策略 |
| `infra/tencent-cos/README.md` | COS 权限、COSCLI 与发布对象参考 |
| `infra/database/README.md` | 数据库服务器部署手册 |
