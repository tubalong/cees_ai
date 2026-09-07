# infra/docker

存放代理、附加镜像与部署期补充配置（如 nginx 反代）。应用自身 Dockerfile 位于各 app 目录。

PostgreSQL/Redis 公共编排位于 `infra/docker-compose.yml`，开发、测试、生产差异分别位于对应的 `docker-compose.*.yml`；腾讯云 COS 配置位于 `infra/tencent-cos/`。
