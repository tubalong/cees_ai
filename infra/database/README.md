# 数据库服务器部署单元

本目录是可独立复制到数据库服务器 `45.40.251.151`（内网 `172.27.0.3`）的完整部署单元，不包含 API、ai-service 或客户端源码。

精确 PostgreSQL/pgvector 与 Redis 镜像标签只在 [docker-compose.yml](docker-compose.yml) 中维护。本目录中的同一份 Compose 定义通过不同环境文件和 Compose 项目名称创建两套独立实例。

## 服务器目录

```text
/opt/cees-db/
├── docker-compose.yml
├── docker-compose.server.yml
├── manage.sh
├── staging/
│   └── .env
└── production/
    └── .env
```

示例文件映射：

```text
.env.staging.example    -> /opt/cees-db/staging/.env
.env.production.example -> /opt/cees-db/production/.env
```

## 环境隔离

| 环境 | Compose 项目 | PostgreSQL 端口 | Redis 端口 | 应用来源 |
| --- | --- | ---: | ---: | --- |
| Staging | `cees-ai-db-staging` | `172.27.0.3:15432` | `172.27.0.3:16379` | `172.27.0.2` |
| Production | `cees-ai-db-production` | `172.27.0.3:25432` | `172.27.0.3:26379` | `172.27.0.2` |

Compose 项目名称会隔离容器、默认网络和数据卷。两个环境即使使用同一份 `docker-compose.yml`，也会创建四个容器和四个独立数据卷。

## 管理命令

```bash
cd /opt/cees-db

bash manage.sh staging validate
bash manage.sh staging
bash manage.sh staging ps
bash manage.sh staging logs
bash manage.sh staging down
```

Production 将命令中的 `staging` 替换为 `production`。`down` 只停止并删除容器和网络，不删除数据卷；禁止把 `down -v` 作为日常运维命令。

## Secret

- `POSTGRES_PASSWORD` 与 `REDIS_PASSWORD` 必须分别生成，且 Staging/Production 不得复用。
- 应用服务器对应环境的 `DATABASE_URL`、`REDIS_URL` 必须使用相同凭据。
- 实际 `.env` 权限设置为 `600`，不得提交 Git、写入 Compose 或粘贴到日志和聊天。
- 示例文件中的所有 `change_me` 必须在启动前替换；`manage.sh validate` 会拒绝包含占位符的配置。

## pgvector 与迁移

数据库容器提供 pgvector 扩展文件，`apps/api/prisma/migrations/0001_init` 会在创建向量字段前执行 `CREATE EXTENSION`。正式业务表和扩展状态统一由 Prisma migration 演进，数据库服务器不执行环境专属建表脚本。

## 网络安全

数据库端口绑定在数据库服务器内网 IP。腾讯云安全组必须只允许应用服务器内网 IP `172.27.0.2` 访问四个数据库端口，并拒绝公网来源。由于腾讯云公网 IP 通过 NAT 映射到内网网卡，绑定内网 IP 不能替代安全组限制。
