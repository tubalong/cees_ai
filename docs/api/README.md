# API 与契约约定

- `packages/contracts/openapi/openapi.yaml` 是公开 API 的唯一事实源。
- 客户端代码一律由契约生成（TS：`packages/api-client`；Dart/Python：各端生成目录），禁止手写替代。
- 变更规则：兼容新增默认可选项并声明默认值；破坏性变更必须提升契约版本，并在此说明迁移方式。
- 统一错误格式、鉴权方式与分页约定先在设计草案中确认，再同步到 OpenAPI 契约。

## 设计草案

- [IAM、租户、RBAC、ACL 与审计 API 设计草案](iam-authorization-api.md)

## 已实现接口

```text
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/me

GET    /api/v1/tenants/current
PATCH  /api/v1/tenants/current
GET    /api/v1/tenants/current/members
GET    /api/v1/tenants/current/members/{membershipId}
PATCH  /api/v1/tenants/current/members/{membershipId}
DELETE /api/v1/tenants/current/members/{membershipId}
PUT    /api/v1/tenants/current/members/{membershipId}/roles

GET    /api/v1/permissions
GET    /api/v1/roles
POST   /api/v1/roles
GET    /api/v1/roles/{roleId}
PATCH  /api/v1/roles/{roleId}
DELETE /api/v1/roles/{roleId}?version={version}
PUT    /api/v1/roles/{roleId}/permissions

GET    /api/v1/documents
POST   /api/v1/documents
GET    /api/v1/documents/{documentId}
PATCH  /api/v1/documents/{documentId}
DELETE /api/v1/documents/{documentId}?version={version}

GET    /api/v1/resources/{resourceId}/acl
POST   /api/v1/resources/{resourceId}/acl
DELETE /api/v1/resources/{resourceId}/acl/{aclEntryId}?version={version}

GET /api/v1/audit-events
GET /api/v1/audit-events/{auditEventId}
```

截至 2026-09-07，第一期 Auth、Tenant/Member、RBAC、Document、ACL 和 Audit 共 28 个接口均已实现。

- `refresh` 每次成功后都会轮换 Refresh Token，旧 Token 立即失效；
- `logout` 撤销当前 Access Token 对应的 Session；
- `me` 返回当前用户、租户、角色和实时计算的权限；
- `logout` 和 `me` 必须携带 `Authorization: Bearer <access-token>`。

## 0.2.0 迁移说明

- User 调整为全局身份，同一个用户可以通过 TenantMembership 加入多个租户；
- JWT `mid`、AuthSession 和角色分配现在使用真实 Membership ID；
- 数据库迁移 `0003_tenant_membership` 会为现有用户回填 Membership；
- 迁移完成后已有 Access Token 必须重新登录获取；
- 客户端必须将 Membership ID 当作不透明 ID，不得假设它与 User ID 相同。

## 0.3.0 迁移说明

- Role 新增稳定且租户内唯一的 `code`、展示名称 `name`、描述和系统角色标识；
- 迁移 `0004_rbac_role_metadata` 会把旧 `name` 转换为 `code`，并回填展示名称；
- `tenant_admin` 被标记为系统角色，不能通过公开 API 修改、替换权限或删除；
- Role 修改、权限替换和删除使用 `version` 做乐观锁控制；
- TenantMember 返回的角色对象新增 `code` 字段。

## 0.4.0 迁移说明

- AuditLog 新增 `outcome` 和 `actorMembershipId` 可查询字段；
- 迁移 `0005_audit_query_fields` 会从历史 metadata 回填成员 ID，并识别失败事件；
- 审计列表支持动作、结果、操作者、资源、请求 ID、时间范围和游标筛选；
- 审计查询始终限制在当前 JWT 对应租户，并要求 `audit.read` 权限。

## 0.5.0 迁移说明

- 新增 Resource、ManagedDocument 和 ResourceAcl 数据模型及迁移 `0006_resource_acl_documents`；
- 原知识库 `Document` Prisma 模型更名为 `KnowledgeDocument`，数据库表名仍为 `documents`，外部数据不迁移；
- Document 访问同时要求对应 RBAC 操作权限和资源范围，资源范围由所有权、`TENANT` 可见性、Membership ACL、Role ACL 或 `document.manage_all` 决定；
- `TENANT` 可见性只扩展 `document.read` 范围，不自动授予修改、删除或分享权限；
- ACL 仅支持 `MEMBERSHIP`、`ROLE` 主体和 `document.read/update/delete/share` 权限，可设置过期时间；
- Document 修改、删除和 ACL 撤销使用 `version` 乐观锁；Document 删除为软删除，ACL 正常撤销为硬删除；
- Document 与 Resource 共用同一个 ID，创建、修改、删除和 ACL 变更均写入审计日志。
- `packages/contracts/openapi/openapi.yaml` 是 NestJS 公开 API 的事实源。
- `packages/contracts/openapi/ai-service.openapi.yaml` 是 NestJS 调用 ai-service 的内部契约。
- 桌面端和移动端不得调用 ai-service 的通用 invoke 或 stream。
- ai-service 使用 `X-AI-Internal-Token` 请求头作为 OpenAPI `apiKey` 安全方案；该 Token 只授予可信内部服务。
- ai-service 的 FastAPI 文档由正式契约生成：Development 和 Staging 可查看、可调用，Production 禁用。
- TypeScript/Python/OpenAPI 生成物禁止手改，契约变更后必须运行 `contracts:lint`、`contracts:gen` 和 `contracts:check`。
- 新增或改变外部行为时先改契约，再实现服务端和调用端；兼容新增字段必须保持可选并声明默认行为。

文件上传的跨领域设计草案见 [文件上传设计](../architecture/file-upload.md)。其中路径和 Schema 只有写入公开 OpenAPI 并通过评审后，才构成正式 API。
