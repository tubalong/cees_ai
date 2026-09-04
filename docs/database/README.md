# 数据库约定

- `apps/api/prisma/schema.prisma` 是数据模型唯一事实源，迁移提交 `prisma/migrations`。
- 向量检索：pgvector，由 `infra/scripts/init-pgvector.sql` 初始化扩展。
- 本地 PostgreSQL 与 Redis 由 `infra/docker-compose.yml` 启动，两者均使用持久化 volume；Redis 必须启用密码。
- 二进制文件不进入数据库，存放于私有腾讯云 COS；数据库只保存对象键、校验值、大小、内容类型与审计元数据。
- AI 服务对业务库只读；正式写入统一经 NestJS。
- 业务模型落地前，先在此文档维护实体与关系草图。
