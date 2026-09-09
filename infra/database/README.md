# 数据库服务器部署包

数据库服务器不需要 clone 完整仓库。开发电脑通过 `scripts/package-database-bundle.ps1` 生成可直接上传、校验和解压的部署包；服务器通过 `deploy-db.sh` 一键准备镜像并启动 PostgreSQL/pgvector 与 Redis。

精确 PostgreSQL/pgvector 与 Redis 镜像标签只在 [docker-compose.yml](docker-compose.yml) 中维护。Staging 与 Production 使用同一份 Compose 定义，但部署在不同服务器上；每台服务器只使用自己的环境文件和数据卷。

## 1. 本地生成部署包

默认生成不包含 Docker 离线镜像的轻量部署包，也不会调用 Docker：

```powershell
pwsh ./scripts/package-database-bundle.ps1 -Environment staging
pwsh ./scripts/package-database-bundle.ps1 -Environment production
```

环境文件自动选择规则：

1. 优先使用 `infra/database/.env.<environment>`；
2. 文件不存在时回退到 `.env.<environment>.example`；
3. 可通过 `-EnvironmentFile <path>` 显式覆盖。

输出目录按环境分开；每次打包前会清空对应环境子目录，只保留本次结果：

```text
dist/database-bundles/<staging|production>/
├── cees-ai-db-<environment>-<timestamp>-<git-sha>.tar.gz
└── cees-ai-db-<environment>-<timestamp>-<git-sha>.tar.gz.sha256
```

压缩包顶层目录固定为 `cees-db/`：

```text
cees-db/
├── .env.<staging|production>
├── docker-compose.yml
├── docker-compose.server.yml
├── deploy-db.sh
├── manage-db.sh
├── DEPLOY.md
└── bundle-manifest.json
```

如果自动或显式选择了真实 `.env`，部署包可能包含数据库和 Redis 密码，必须通过受控通道传输并删除不必要副本。脚本输出的 `Mode: template` 表示配置仍含 `change_me`，服务器部署前必须填写；`Mode: ready` 表示没有占位值。

### 可选包含离线镜像

只有明确指定 `-IncludeImages` 时，打包脚本才检查本机 Docker 镜像，拉取本机缺少的镜像，并生成 `images/database-images.tar`：

```powershell
pwsh ./scripts/package-database-bundle.ps1 `
  -Environment staging `
  -IncludeImages
```

默认不要使用该参数，数据库服务器能够访问镜像仓库时由服务器按需拉取即可。

## 2. 上传、校验和解压

上传压缩包及校验文件：

```powershell
scp ./dist/database-bundles/<staging|production>/<压缩包>.tar.gz `
  ./dist/database-bundles/<staging|production>/<压缩包>.tar.gz.sha256 `
  root@<database-server>:/tmp/
```

服务器执行：

```bash
cd /tmp
sha256sum -c <压缩包>.tar.gz.sha256
mkdir -p /opt
tar -xzf <压缩包>.tar.gz -C /opt
cd /opt/cees-db
```

如果是模板包，填写对应环境文件并限制权限：

```bash
nano .env.staging
chmod 600 .env.staging
```

Production 将文件名替换为 `.env.production`。部署前必须确认没有占位值：

```bash
if grep -n "change_me" .env.staging; then
  echo "仍有 change_me，禁止部署"
  exit 1
fi
```

## 3. 一键部署

```bash
cd /opt/cees-db
bash deploy-db.sh staging
```

Production 使用：

```bash
bash deploy-db.sh production
```

`deploy-db.sh` 的镜像选择规则如下：

1. 检查部署目录本身和 `images/` 子目录中的 `*.tar`、`*.tar.gz`、`*.tgz`；
2. 找到离线镜像包时，先逐个执行 `docker image load`；
3. 根据 Compose 实际所需镜像逐个检查，本地仍缺少的镜像才执行 `docker pull`；
4. 完全没有离线镜像包时，执行 `docker compose pull`；
5. 镜像准备完成后通过 `manage-db.sh` 以 `--pull never` 启动，避免启动阶段隐式拉取。

因此可以在不重新打包的情况下，把额外离线镜像文件直接放到 `/opt/cees-db/` 或 `/opt/cees-db/images/`，再次执行部署脚本即可。

## 4. 日常管理

```bash
cd /opt/cees-db

bash manage-db.sh staging validate
bash manage-db.sh staging ps
bash manage-db.sh staging logs
bash manage-db.sh staging logs postgres
bash manage-db.sh staging down
```

Production 将命令中的 `staging` 替换为 `production`。`manage-db.sh up` 只使用本机已存在镜像，不执行拉取；正常部署应使用 `deploy-db.sh`。

`down` 只停止并删除容器和网络，不删除数据卷；禁止把 `down -v` 作为日常运维命令。

## 5. 环境隔离

| 环境 | Compose 项目 | PostgreSQL 端口 | Redis 端口 | 应用来源 |
| --- | --- | ---: | ---: | --- |
| Staging | `cees-ai-db-staging` | `<数据库私网 IP>:5432` | `<数据库私网 IP>:6379` | 应用服务器私网地址 |
| Production | `cees-ai-db-production` | `<数据库私网 IP>:5432` | `<数据库私网 IP>:6379` | 应用服务器私网地址 |

Staging 与 Production 位于不同服务器，均使用 PostgreSQL `5432` 和 Redis `6379`。Compose 项目名称继续用于标识环境；两个环境的容器、账号、密码和数据卷不得复用。

## 6. Secret

- `POSTGRES_PASSWORD` 与 `REDIS_PASSWORD` 必须分别生成，且 Staging/Production 不得复用。
- 应用服务器对应环境的 `DATABASE_URL`、`REDIS_URL` 必须使用相同凭据。
- 实际 `.env` 权限设置为 `600`，不得提交 Git、写入 Compose 或粘贴到日志和聊天。
- 示例文件中的所有 `change_me` 必须在启动前替换；`manage-db.sh validate` 会拒绝包含占位符的配置。

## 7. pgvector 与迁移

数据库容器提供 pgvector 扩展文件，`apps/api/prisma/migrations/0001_init` 会在创建向量字段前执行 `CREATE EXTENSION`。正式业务表和扩展状态统一由 Prisma migration 演进，数据库服务器不执行环境专属建表脚本，也不需要 Prisma 源码。

应用部署包中的一次性 `migrate` 服务使用 API 镜像执行 `prisma migrate deploy`。部署顺序必须是：先通过本部署包启动数据库，再部署应用。

## 8. 网络安全

数据库端口绑定在 `DB_BIND_IP` 指定的地址。设置为 `0.0.0.0` 或 `::` 时，`manage-db.sh validate` 会输出警告但不会阻止启动；此时必须通过防火墙或安全组限制数据库端口来源并拒绝公网访问。
