# infra/docker

存放代理、附加镜像与部署期补充配置（如 nginx 反代）。应用自身 Dockerfile 位于各 app 目录。

PostgreSQL/Redis 的唯一公共编排和数据库服务器部署入口位于 `infra/database/`；应用服务器编排位于 `infra/docker-compose.deploy.yml` 及对应环境覆盖；腾讯云 COS 配置位于 `infra/tencent-cos/`。
