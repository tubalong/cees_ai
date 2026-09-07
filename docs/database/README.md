# 数据库约定

> 当前数据库迁移以 `0001_init` 作为完整空库基线，与现有 `schema.prisma` 保持一致；新环境直接执行该迁移，不需要历史数据回填。

- `apps/api/prisma/schema.prisma` 是数据模型唯一事实源，迁移提交 `prisma/migrations`。
- PostgreSQL/pgvector 与 Redis 的精确镜像标签只在 `infra/database/docker-compose.yml` 维护。
- 向量检索使用 pgvector；扩展由 `0001_init` 在创建向量字段前启用，不使用环境专属初始化 SQL。
- AI 服务对业务库只读；正式写入统一经 NestJS。
- 业务模型落地前，先在此文档维护实体与关系草图。

## 身份与租户关系

```text
User
  └── TenantMembership
        ├── Tenant
        ├── Department
        └── MembershipRole
              └── Role
```

- User 是全局登录身份，`normalizedEmail` 全局唯一；
- TenantMembership 表示用户在特定租户中的成员身份和状态；
- AuthSession 必须同时绑定 User、Tenant 和 TenantMembership；
- MembershipRole 负责成员与租户角色的关联。

## RBAC 角色模型

- Role 使用租户内唯一且不可变的 `code` 作为程序标识，`name` 用于界面展示；
- `isSystem` 标识平台管理的系统角色，公开接口不能修改或删除系统角色；
- RolePermission 保存角色的最终权限集合，权限变更通过事务整体替换。

## 审计查询模型

- AuditLog 使用 `outcome` 区分成功与失败，并单独保存 `actorMembershipId`；
- `tenantId` 必须参与所有审计查询条件，禁止跨租户读取；
- 时间、动作、结果和操作者字段均建立了对应查询索引。

## 受控资源与 ACL 模型

```text
Resource
  ├── ownerMembership -> TenantMembership
  ├── document -> ManagedDocument
  └── acls -> ResourceAcl[]
```

- Resource 是受控业务资源的统一授权根，第一期 `type` 仅支持 `DOCUMENT`；
- ManagedDocument 与 Resource 共用主键，保存标题、正文和 `PRIVATE`/`TENANT` 可见性；
- ResourceAcl 支持 `MEMBERSHIP` 和 `ROLE` 主体，保存权限编码数组及可选过期时间；
- 最终授权是 RBAC 操作权限与所有权、可见性、ACL 或 `document.manage_all` 资源范围的交集；
- `TENANT` 可见性只扩展读取范围，不能授予修改、删除或分享能力；
- Document 删除会软删除 ManagedDocument、Resource 和 ACL，正常 ACL 撤销采用硬删除以允许后续重新授权；
- 原知识库文档 Prisma 模型已更名为 KnowledgeDocument，仍映射原 `documents` 表，与 ManagedDocument 分离。
- `apps/api/prisma/schema.prisma` 是数据模型唯一事实源，迁移提交到 `apps/api/prisma/migrations`。
- `0001_init` 包含 pgvector 扩展和当前 `schema.prisma` 的完整空库结构；共享环境首次执行后，后续结构变化必须新增前向迁移，不再重写该基线。
- 本地 PostgreSQL 与 Redis 由 `infra/database/docker-compose.yml` 和本地开发覆盖启动；共享环境数据库由独立数据库服务器运行，Redis 必须启用密码。
- Staging API 使用数据库服务器内网端口 `15432`/`16379`，Production 使用 `25432`/`26379`；两个环境使用独立容器和数据卷。
- 二进制文件不进入数据库，存放于私有腾讯云 COS；数据库只保存对象键、校验值、大小、内容类型和审计元数据。
- ai-service 当前不直接连接业务数据库；正式数据读取、写入和 AI 调用审计统一由 NestJS 处理。
- 未确认的业务实体不得提前加入 Prisma schema。
