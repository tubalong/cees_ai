# API 与契约约定

- `packages/contracts/openapi/openapi.yaml` 是公开 API 的唯一事实源。
- 客户端代码一律由契约生成（TS：`packages/api-client`；Dart/Python：各端生成目录），禁止手写替代。
- 变更规则：兼容新增默认可选项并声明默认值；破坏性变更必须提升契约版本，并在此说明迁移方式。
- 统一错误格式、鉴权方式与分页约定先在设计草案中确认，再同步到 OpenAPI 契约。

## 设计草案

- [IAM、租户、RBAC、ACL 与审计 API 设计草案](iam-authorization-api.md)
- [平台租户管理与租户账号激活](platform-tenant-administration.md)
- [组织部门管理](../product/organization-department-management.md)
- [用户个人资料管理](../product/user-profile-management.md)
- [平台使用、接口与数据库字典](../product/platform-usage-guide.md)：按当前 OpenAPI 汇总全部接口、请求参数和验证顺序。

## 已实现接口

```text
POST /api/v1/auth/login
POST /api/v1/auth/activate
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/me

GET   /api/v1/users/me/profile
PATCH /api/v1/users/me/profile

GET    /api/v1/tenants/current
PATCH  /api/v1/tenants/current
GET    /api/v1/tenants/current/departments
POST   /api/v1/tenants/current/departments
GET    /api/v1/tenants/current/departments/{departmentId}
PATCH  /api/v1/tenants/current/departments/{departmentId}
DELETE /api/v1/tenants/current/departments/{departmentId}?version={version}
GET    /api/v1/tenants/current/departments/{departmentId}/members
GET    /api/v1/tenants/current/members
GET    /api/v1/tenants/current/members/{membershipId}
PATCH  /api/v1/tenants/current/members/{membershipId}
DELETE /api/v1/tenants/current/members/{membershipId}
PUT    /api/v1/tenants/current/members/{membershipId}/roles
PUT    /api/v1/tenants/current/members/{membershipId}/department

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

POST /api/v1/platform/auth/login
POST /api/v1/platform/auth/refresh
POST /api/v1/platform/auth/logout
GET  /api/v1/platform/auth/me

GET    /api/v1/platform/tenants
POST   /api/v1/platform/tenants
GET    /api/v1/platform/tenants/{tenantId}
PATCH  /api/v1/platform/tenants/{tenantId}
POST   /api/v1/platform/tenants/{tenantId}/suspend
POST   /api/v1/platform/tenants/{tenantId}/restore
GET    /api/v1/platform/tenants/{tenantId}/administrators
POST   /api/v1/platform/tenants/{tenantId}/administrators
DELETE /api/v1/platform/tenants/{tenantId}/administrators/{membershipId}

GET    /api/v1/tenants/current/invitations
POST   /api/v1/tenants/current/invitations
DELETE /api/v1/tenants/current/invitations/{invitationId}
POST   /api/v1/tenants/current/account-suggestions
PATCH  /api/v1/tenants/current/members/{membershipId}/account
POST   /api/v1/tenants/current/members/{membershipId}/credential-reset

GET /api/v1/platform/audit-events
GET /api/v1/platform/audit-events/{auditEventId}
```

截至 2026-09-08，身份、用户个人资料、租户、组织部门、RBAC、ACL、审计、平台租户管理和租户账号激活接口均已实现。

- `refresh` 每次成功后都会轮换 Refresh Token，旧 Token 立即失效；
- `logout` 撤销当前 Access Token 对应的 Session；
- `me` 返回当前用户、租户、角色和实时计算的权限；
- 个人资料接口允许有效成员查询并修改自己在当前租户内的展示名，不要求额外 RBAC 权限；
- `logout`、`me` 和个人资料接口必须携带 `Authorization: Bearer <access-token>`。

## 身份与会话

- User 是全局身份，同一个用户可以通过 TenantMembership 加入多个租户；
- JWT `mid`、AuthSession 和角色分配使用真实 Membership ID；
- 客户端必须将 Membership ID 当作不透明 ID，不得假设它与 User ID 相同。

## RBAC

- Role 使用稳定且租户内唯一的 `code`、展示名称 `name`、描述和系统角色标识；
- `tenant_admin` 被标记为系统角色，不能通过公开 API 修改、替换权限或删除；
- Role 修改、权限替换和删除使用 `version` 做乐观锁控制；
- TenantMember 返回的角色对象包含 `code` 字段。

## 审计

- AuditLog 使用 `outcome` 和 `actorMembershipId` 作为可查询字段；
- 审计列表支持动作、结果、操作者、资源、请求 ID、时间范围和游标筛选；
- 审计查询始终限制在当前 JWT 对应租户，并要求 `audit.read` 权限。

## Document 与 ACL

- Resource、ManagedDocument 和 ResourceAcl 构成文档授权模型；
- 知识库文档使用 `KnowledgeDocument` Prisma 模型，数据库表名为 `documents`，与 ManagedDocument 分离；
- Document 访问同时要求对应 RBAC 操作权限和资源范围，资源范围由所有权、`TENANT` 可见性、Membership ACL、Role ACL 或 `document.manage_all` 决定；
- `TENANT` 可见性只扩展 `document.read` 范围，不自动授予修改、删除或分享权限；
- ACL 仅支持 `MEMBERSHIP`、`ROLE` 主体和 `document.read/update/delete/share` 权限，可设置过期时间；
- Document 修改、删除和 ACL 撤销使用 `version` 乐观锁；Document 删除为软删除，ACL 正常撤销为硬删除；
- Document 与 Resource 共用同一个 ID，创建、修改、删除和 ACL 变更均写入审计日志。

## 0.6.0 迁移说明

- 新增独立 PlatformAdministrator、PlatformAuthSession 和平台 JWT，不复用租户 `tenant_admin` 身份；
- 新增平台租户创建、查询、修改、停用、恢复和管理员管理接口；
- 新租户会初始化 `tenant_admin` 系统角色及完整权限目录；
- 新增 TenantInvitation 与公开接受邀请接口，新用户接受时设置密码；
- TenantStatus 新增 `PENDING_ACTIVATION`；首位管理员接受邀请后自动激活租户；
- 新增 PlatformAuditLog，平台操作与租户审计保持隔离；
- 数据库迁移为 `0002_platform_tenant_administration`，契约版本提升为 `0.6.0`。

## 0.7.0 迁移说明

- 租户登录由 `tenantCode + email + password` 改为 `tenantCode + account + password`；
- 账号只允许 3～32 位英文字母和数字，同一租户内按小写唯一；
- TenantMembership 保存租户级密码、登录失败次数、锁定时间和最后登录时间；
- PlatformAdministrator 使用独立且全局唯一的平台账号与密码；
- TenantInvitation 从邮箱邀请改为账号激活和凭证重置令牌；
- 新增拼音账号建议、账号修改和管理员凭证重置接口；
- 手机和邮箱绑定、自助密码找回暂不实现；忘记密码由租户管理员签发新激活令牌；
- 数据库迁移仍在未发布的 `0002_platform_tenant_administration` 中同步调整，契约版本提升为 `0.7.0`。
- `packages/contracts/openapi/openapi.yaml` 是 NestJS 公开 API 的事实源。
- `packages/contracts/openapi/ai-service.openapi.yaml` 是 NestJS 调用 ai-service 的内部契约。
- 桌面端和移动端不得调用 ai-service 的通用 invoke 或 stream。
- ai-service 文档接口同样只供 NestJS 内部调用；客户端不得绕过业务权限直接 compose 或 render。
- ai-service 使用 `X-AI-Internal-Token` 请求头作为 OpenAPI `apiKey` 安全方案；该 Token 只授予可信内部服务。
- ai-service 的 FastAPI 文档由正式契约生成：Development 和 Staging 可查看、可调用，Production 禁用。
- TypeScript/Python/OpenAPI 生成物禁止手改，契约变更后必须运行 `contracts:lint`、`contracts:gen` 和 `contracts:check`。
- 新增或改变外部行为时先改契约，再实现服务端和调用端；兼容新增字段必须保持可选并声明默认行为。

文件上传的跨领域设计草案见 [文件上传设计](../architecture/file-upload.md)。其中路径和 Schema 只有写入公开 OpenAPI 并通过评审后，才构成正式 API。
