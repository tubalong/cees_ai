# 基础设施

CEES AI 的共享测试环境（Staging）和生产环境（Production）部署在两台职责分离的腾讯云服务器上。两台服务器位于同一 VPC，服务间只使用内网地址通信。

| 服务器 | 公网 IP | 内网 IP | 职责 |
| --- | --- | --- | --- |
| 应用服务器 | `1.14.103.59` | `172.27.0.2` | API、ai-service；Staging 与 Production 分别运行 |
| 数据库服务器 | `45.40.251.151` | `172.27.0.3` | PostgreSQL、Redis；Staging 与 Production 分别运行 |

公网 IP 只用于 SSH、HTTPS 和受控运维入口。应用访问 PostgreSQL/Redis 时必须使用数据库服务器内网 IP `172.27.0.3`。

## 物理部署与环境隔离

```text
应用服务器 1.14.103.59 / 172.27.0.2
├── /opt/cees-ai/staging/       -> cees-ai-staging Compose 项目
└── /opt/cees-ai/production/    -> cees-ai-production Compose 项目

数据库服务器 45.40.251.151 / 172.27.0.3
└── /opt/cees-db/
    ├── docker-compose.yml       -> PostgreSQL/Redis 唯一公共定义
    ├── docker-compose.server.yml
    ├── manage.sh
    ├── staging/.env             -> cees-ai-db-staging Compose 项目
    └── production/.env          -> cees-ai-db-production Compose 项目
```

同一物理服务器上的 Staging 与 Production 共享 Docker daemon 和主机资源，但必须使用独立的：

- 代码目录或环境配置目录；
- Compose 项目名称和网络；
- PostgreSQL、Redis 容器；
- Docker 数据卷；
- 数据库、账号、密码和 Redis 密码；
- 宿主机端口、日志和备份。

数据库服务器最终运行四个长期容器：Staging PostgreSQL、Staging Redis、Production PostgreSQL、Production Redis。两个环境不得合并为同一 PostgreSQL 数据库实例或同一 Redis 实例。

## 部署文件

| 文件 | 部署位置 | 作用 |
| --- | --- | --- |
| `database/docker-compose.yml` | 本地开发、数据库服务器 | PostgreSQL/pgvector 和 Redis 的唯一公共定义；精确镜像标签只在此维护 |
| `database/docker-compose.server.yml` | 数据库服务器 | 内网端口、持久化卷和重启策略 |
| `database/manage.sh` | 数据库服务器 | 按环境固定 Compose 项目名并管理数据库容器 |
| `docker-compose.dev.yml` | 开发电脑 | 本地开发端口和开发数据卷 |
| `docker-compose.deploy.yml` | 应用服务器 | migration、API 和 ai-service 公共定义 |
| `docker-compose.staging.yml` | 应用服务器 | Staging 重启策略与 API 端口 |
| `docker-compose.prod.yml` | 应用服务器 | Production 重启策略与 API 端口 |

数据库服务器部署单元及其环境文件见 [database/README.md](database/README.md)。

## 环境与连接关系

| 环境 | 应用环境文件 | 数据库环境文件 | PostgreSQL | Redis |
| --- | --- | --- | --- | --- |
| 本地开发 | 根目录 `.env` | 同一个 `.env` | `localhost:5432` | `localhost:6379` |
| Staging | 应用目录 `.env.staging` | `/opt/cees-db/staging/.env` | `172.27.0.3:15432` | `172.27.0.3:16379` |
| Production | 应用目录 `.env.production` | `/opt/cees-db/production/.env` | `172.27.0.3:25432` | `172.27.0.3:26379` |

表中的端口是仓库环境示例的当前默认值；实际部署值以对应服务器上的未提交 `.env` 为准。修改端口时必须同时更新数据库服务器绑定、应用连接串和腾讯云安全组。

## 本地开发

本地开发仍由开发电脑运行 PostgreSQL/Redis，API 和 ai-service 作为本地进程启动：

```powershell
Copy-Item .env.example .env
pnpm infra:up
```

查看和关闭：

```powershell
pnpm infra:logs
pnpm infra:down
```

## 数据库服务器

数据库服务器不存放业务源码。将仓库 `infra/database/` 中的部署单元复制为 `/opt/cees-db/`，再分别从示例创建环境文件：

```text
infra/database/.env.staging.example    -> /opt/cees-db/staging/.env
infra/database/.env.production.example -> /opt/cees-db/production/.env
```

真实密码只保存在服务器未提交的 `.env` 或平台 Secret 管理器中，文件权限必须限制为 `600`。常用入口：

```bash
cd /opt/cees-db
bash manage.sh staging validate
bash manage.sh staging
bash manage.sh staging ps
bash manage.sh staging logs postgres
```

Production 使用同一个 `manage.sh`，但项目名、环境文件、容器、网络和数据卷都与 Staging 分离：

```bash
bash manage.sh production validate
bash manage.sh production
```

管理脚本不会执行 `down -v`，数据库数据卷不能通过日常启停命令删除。

## 应用服务器

应用服务器保留两个独立代码目录，避免构建 Staging 时读取 Production 代码或反向污染：

```text
/opt/cees-ai/staging/
/opt/cees-ai/production/
```

Staging 使用 `.env.staging`，Production 使用 `.env.production`。两个连接串中的密码必须分别与数据库服务器对应环境的 `.env` 一致。应用部署脚本只管理 API、ai-service 和 migration，不会在应用服务器启动 PostgreSQL/Redis。

```bash
cd /opt/cees-ai/staging
bash scripts/compose-deploy.sh staging validate
bash scripts/compose-deploy.sh staging
```

Production 必须检出已在 Staging 验证通过的明确 commit/tag，再从独立目录发布：

```bash
cd /opt/cees-ai/production
bash scripts/compose-deploy.sh production validate
bash scripts/compose-deploy.sh production
```

部署脚本不会执行 `git pull`。发布前必须由操作者明确更新代码并核对 `git rev-parse HEAD`。

## 部署顺序与迁移

1. 先启动对应环境的数据库服务器容器并确认健康。
2. 确认数据库服务器安全组只允许应用服务器内网 IP `172.27.0.2` 访问对应数据库端口。
3. 在应用服务器执行部署脚本。
4. 一次性 `migrate` 服务通过内网连接 PostgreSQL 并执行 `prisma migrate deploy`。
5. migration 成功且 ai-service readiness 通过后，API 才启动。

pgvector 扩展二进制由数据库公共 Compose 中的 PostgreSQL 镜像提供，数据库扩展由 Prisma migration 启用，不使用额外的手工建表或环境专属初始化脚本。

## 网络与安全

- 数据库连接只能使用 `172.27.0.3`，不得使用数据库服务器公网 IP `45.40.251.151`。
- PostgreSQL/Redis 端口只允许来源 `172.27.0.2`，不得对 `0.0.0.0/0` 放行。
- Redis 密码提供认证但不提供公网传输加密；依赖 VPC 和安全组隔离。
- Staging 与 Production 不得共享数据库、Redis、COS 前缀、JWT Secret、内部 Token 或模型 API Key。
- ai-service 在 Staging/Production 均不映射宿主机端口，只允许同一 Compose 项目内的 API 访问。
- 腾讯云 COS 不在 Compose 中运行，其最小权限策略见 [tencent-cos/README.md](tencent-cos/README.md)。
腾讯云 COS 不在 Compose 中启动，配置与最小权限策略见 [tencent-cos/README.md](tencent-cos/README.md)。
# 基础设施

PostgreSQL 使用 `pgvector/pgvector:pg16`，因为 Prisma 模型中的 `DocumentChunk.embedding` 依赖 `vector` 类型。迁移 `0002_schema_with_auth` 会执行 `CREATE EXTENSION IF NOT EXISTS vector`；托管 PostgreSQL 环境必须提前确认允许启用 pgvector。
