# 数据库约定

- `apps/api/prisma/schema.prisma` 是数据模型唯一事实源，迁移提交 `prisma/migrations`。
- 向量检索：pgvector，由 `infra/scripts/init-pgvector.sql` 初始化扩展。
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
- MembershipRole 负责成员与租户角色的关联；
- 迁移 `0003_tenant_membership` 会从旧的 tenant-scoped User 回填成员关系。

## RBAC 角色模型

- Role 使用租户内唯一且不可变的 `code` 作为程序标识，`name` 用于界面展示；
- `isSystem` 标识平台管理的系统角色，公开接口不能修改或删除系统角色；
- RolePermission 保存角色的最终权限集合，权限变更通过事务整体替换；
- 迁移 `0004_rbac_role_metadata` 会把旧 Role `name` 字段迁移为 `code` 并补齐展示元数据。

## 审计查询模型

- AuditLog 使用 `outcome` 区分成功与失败，并单独保存 `actorMembershipId`；
- `tenantId` 必须参与所有审计查询条件，禁止跨租户读取；
- 迁移 `0005_audit_query_fields` 会从旧 metadata 回填成员 ID，并建立时间、动作、结果和操作者索引。
