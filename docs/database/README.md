# 数据库约定

- `apps/api/prisma/schema.prisma` 是数据模型唯一事实源，迁移提交 `prisma/migrations`。
- 向量检索：pgvector，由 `infra/scripts/init-pgvector.sql` 初始化扩展。
- AI 服务对业务库只读；正式写入统一经 NestJS。
- 业务模型落地前，先在此文档维护实体与关系草图。
