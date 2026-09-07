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
- 迁移 `0006_resource_acl_documents` 会重建此前未公开使用的占位 ACL 表；若表中存在旧数据，迁移会中止并要求人工处理；
- 原知识库文档 Prisma 模型已更名为 KnowledgeDocument，仍映射原 `documents` 表，与 ManagedDocument 分离。
