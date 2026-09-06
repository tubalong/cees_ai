# 数据库约定

- `apps/api/prisma/schema.prisma` 是数据模型唯一事实源，迁移提交到 `apps/api/prisma/migrations`。
- 当前 `0001_init` 是从空数据库生成的完整基线；数据库尚未投入使用前可以校正该基线，投入使用后只能新增前向迁移。
- 本地 PostgreSQL 与 Redis 由 `infra/docker-compose.yml` 启动；Redis 必须启用密码。
- 二进制文件不进入数据库，存放于私有腾讯云 COS；数据库只保存对象键、校验值、大小、内容类型和审计元数据。
- ai-service 当前不直接连接业务数据库；正式数据读取、写入和 AI 调用审计统一由 NestJS 处理。
- 未确认的业务实体不得提前加入 Prisma schema。
