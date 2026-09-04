# 基础设施

`infra` 只负责本地依赖编排与云基础设施配置，不承载应用业务代码。

## 组成

| 资源 | 位置 | 说明 |
| --- | --- | --- |
| 公共配置 | `docker-compose.yml` | PostgreSQL/pgvector、Redis 镜像、认证与健康检查 |
| 开发覆盖 | `docker-compose.dev.yml` | 开放本机端口并使用开发环境持久卷 |
| 测试覆盖 | `docker-compose.test.yml` | 使用独立端口和 tmpfs 临时数据 |
| 生产覆盖 | `docker-compose.prod.yml` | 不开放数据端口，启用重启策略和生产持久卷 |
| 腾讯云 COS | `tencent-cos/` | 外部托管对象存储，不在本地启动兼容服务 |

## 环境切换

| 环境 | Compose 组合 | 环境变量文件 | 数据特性 |
| --- | --- | --- | --- |
| 开发 | `docker-compose.yml` + `docker-compose.dev.yml` | `.env` | 持久化，可从宿主机访问 |
| 测试 | `docker-compose.yml` + `docker-compose.test.yml` | `.env.test` | 临时数据，默认端口 55432/56379 |
| 生产 | `docker-compose.yml` + `docker-compose.prod.yml` | `.env.production` | 持久化，不向宿主机公开数据库端口 |

环境地址不写死在 YAML 中。Docker 网络内使用服务名 `postgres`、`redis`；宿主机开发和测试使用 `localhost` 与对应映射端口。未来改用云数据库或云 Redis 时，只需替换生产环境连接 URL。

## 启动命令

在仓库根目录执行：

```powershell
Copy-Item .env.example .env
# 替换所有 change_me，并填写真实的腾讯云 COS 配置
pnpm infra:up
```

测试环境：

```powershell
Copy-Item .env.test.example .env.test
# 填写只能访问 cees/test 前缀的非生产 CAM 凭据
pnpm infra:test:up
```

生产环境使用 Compose 部署时：

```powershell
Copy-Item .env.production.example .env.production
# 必须替换所有 change_me；真实部署优先由平台 Secrets 生成该文件
pnpm infra:prod:up
```

对应停止和日志命令：

```text
pnpm infra:logs
pnpm infra:down
pnpm infra:dev:logs
pnpm infra:dev:down
pnpm infra:test:logs
pnpm infra:test:down
pnpm infra:prod:logs
pnpm infra:prod:down
```

宿主机应用使用 `.env` 中指向 `localhost` 的 `DATABASE_URL` 与 `REDIS_URL`。容器化部署应用时，应由部署平台分别注入容器网络地址和最小权限 Secret。

如果数据库或 Redis 密码包含 `@`、`:`、`/` 等字符，写入连接 URL 前必须进行 URL 编码。

腾讯云 COS 是外部服务，因此不会出现在 Docker Compose 中。接入与权限约定见 [tencent-cos/README.md](tencent-cos/README.md)。
