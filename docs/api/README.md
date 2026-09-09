# API 与契约约定

- `packages/contracts/openapi/openapi.yaml` 是公开 API 的唯一事实源。
- 客户端代码一律由契约生成（TS：`packages/api-client`；Dart/Python：各端生成目录），禁止手写替代。
- 变更规则：兼容新增默认可选项并声明默认值；破坏性变更必须提升契约版本，并在此说明迁移方式。
- 统一错误格式、鉴权方式与分页约定先在设计草案中确认，再同步到 OpenAPI 契约。

## 设计草案

- [IAM、租户、RBAC、ACL 与审计 API 设计草案](iam-authorization-api.md)
- [平台租户管理与租户账号激活](platform-tenant-administration.md)
- [组织部门管理](../product/organization-department-management.md)
- [组织架构与成员批量导入](../product/organization-member-import.md)
- [项目管理 API](project-management-api.md)
- [项目与项目成员管理](../product/project-management.md)
- [用户个人资料管理](../product/user-profile-management.md)
- [密码修改与凭证安全](../security/password-management.md)
- [平台使用、接口与数据库字典](../product/platform-usage-guide.md)：按当前 OpenAPI 汇总全部接口、请求参数和验证顺序。

## 已实现接口

```text
POST /api/v1/auth/login
POST /api/v1/auth/activate
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/me
POST /api/v1/auth/change-password

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
POST   /api/v1/tenants/current/organization-imports/validate
POST   /api/v1/tenants/current/organization-imports/confirm
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

POST /api/v1/upload-sessions
POST /api/v1/upload-sessions/{uploadSessionId}/complete

POST /api/v1/platform/auth/login
POST /api/v1/platform/auth/refresh
POST /api/v1/platform/auth/logout
GET  /api/v1/platform/auth/me
POST /api/v1/platform/auth/change-password

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

GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/{projectId}
PATCH  /api/v1/projects/{projectId}
DELETE /api/v1/projects/{projectId}?version={version}
GET    /api/v1/projects/{projectId}/members
POST   /api/v1/projects/{projectId}/members
PATCH  /api/v1/projects/{projectId}/members/{membershipId}
DELETE /api/v1/projects/{projectId}/members/{membershipId}?version={version}
PUT    /api/v1/projects/{projectId}/owner
POST   /api/v1/projects/{projectId}/start
POST   /api/v1/projects/{projectId}/pause
POST   /api/v1/projects/{projectId}/resume
POST   /api/v1/projects/{projectId}/complete
POST   /api/v1/projects/{projectId}/reopen
POST   /api/v1/projects/{projectId}/cancel
POST   /api/v1/projects/{projectId}/archive
POST   /api/v1/projects/{projectId}/restore
```

截至 2026-09-08，身份、本人密码修改、用户个人资料、租户、组织部门、项目与项目成员、RBAC、ACL、审计、平台租户管理、租户账号激活和 COS 基础上传接口均已实现。

- `refresh` 每次成功后都会轮换 Refresh Token，旧 Token 立即失效；
- `logout` 撤销当前 Access Token 对应的 Session；
- `me` 返回当前用户、租户、角色和实时计算的权限；
- 个人资料接口允许有效成员查询并修改自己在当前租户内的展示名，不要求额外 RBAC 权限；
- 改密接口校验当前密码，成功后保留当前 Session 并撤销其他 Session；
- `logout`、`me`、个人资料和改密接口必须携带对应身份域的 Bearer Token。

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

## 0.9.0 迁移说明

- 公开契约版本由 `0.8.0` 提升为 `0.9.0`；
- 新增 `POST /upload-sessions`，要求 JWT、有效 TenantContext 和 `Idempotency-Key`，返回单对象预签名 PUT URL；
- 新增 `POST /upload-sessions/{uploadSessionId}/complete`，服务端通过 COS HEAD 校验对象后创建正式文件记录；
- 第一版只支持 `purpose=attachment` 和 `uploadMode=single`；默认技术上限为 100 MiB，系统硬上限为 500 MiB；
- COS 对象键由服务端按 `cees/{environment}/tenants/{tenantId}/files/{yyyy}/{mm}/{fileId}/source` 生成；
- 当前尚未启用 `file.*` 细粒度权限和租户额度，调用者必须至少是当前租户的有效登录成员；
- 新增 Prisma 迁移 `0004_redis_cos_upload_foundation`；
- 公开 TypeScript 客户端生成已接入 `pnpm contracts:gen`，生成物禁止手改。

## 0.10.0 迁移说明

- 公开契约版本由 `0.9.0` 提升为 `0.10.0`；
- 新增租户成员和平台管理员本人修改密码接口；
- 成功改密会撤销除当前 Session 之外的其他 Session；
- 接口复用现有数据模型，不需要数据库迁移。

## 0.11.0 迁移说明

- 公开契约版本由 `0.10.0` 提升为 `0.11.0`；
- 新增项目 CRUD、项目成员、负责人转移和项目状态命令；
- 同租户成员默认不能访问未参与项目，跨项目管理需要 `project.manage_all`；
- 完成、取消和归档项目禁止修改资料与成员，完成前必须清理未完成任务；
- 新增 Prisma 迁移 `0005_project_management`，客户端需要重新生成。

## 0.12.0 迁移说明

- 公开契约版本由 `0.11.0` 提升为 `0.12.0`；
- 新增组织架构和成员批量校验、确认导入接口；
- 前端解析 Excel，API 接收最多 200 个部门、500 名成员和 2 MiB JSON；
- 确认导入事务创建待激活成员、角色关系和独立激活凭证；
- 已有启用部门按路径复用，第一版只创建新成员并禁止批量分配 `tenant_admin`；
- 复用现有 Prisma 数据模型，不需要新增数据库迁移，TypeScript 客户端需要重新生成。

## 契约事实源

- `packages/contracts/openapi/openapi.yaml` 是 NestJS 公开 API 的事实源。
- `packages/contracts/openapi/ai-service.openapi.yaml` 是 NestJS 调用 ai-service 的内部契约。
- 桌面端和移动端不得调用 ai-service 的通用 invoke 或 stream。
- ai-service Chat 与文档接口同样只供 NestJS 内部调用；客户端不得绕过业务权限直接 chat、compact、compose 或 render。
- Chat 调用方必须保存正式会话状态，并在每轮传入历史摘要与近期消息；ai-service 不持久化 Conversation 或 Message。
- ai-service 使用 `X-AI-Internal-Token` 请求头作为 OpenAPI `apiKey` 安全方案；该 Token 只授予可信内部服务。
- ai-service 的 FastAPI 文档由正式契约生成：Development 和 Staging 可查看、可调用，Production 禁用。
- TypeScript/Python/OpenAPI 生成物禁止手改，契约变更后必须运行 `contracts:lint`、`contracts:gen` 和 `contracts:check`。
- 新增或改变外部行为时先改契约，再实现服务端和调用端；兼容新增字段必须保持可选并声明默认行为。

## ai-service 上下文对话适配说明（2026-09-08）

- 内部契约新增 `invokeChat`、`streamChat` 和 `compactChat`；原有 LLM 与文档接口路径和请求结构不变；
- `ChatRequest.mode` 支持 `standard`、`ultra`，省略时默认为 `standard`；
- 调用方必须传 `conversation_id`，并在每轮传入完整可用历史或 `conversation_summary + recent messages`；
- `streamChat` 新增独立的 `ChatStreamEvent` 联合，事件为 `started/status/content_delta/usage/completed/error`，不能按原 `StreamEvent` 类型解析；
- `compactChat` 返回的 `summary` 和 `summarized_through_message_id` 必须由调用方持久化；
- `/ready` 响应新增必填 `configured_chat_modes`；
- 部署拥有的 `AI_MODEL_CONFIG_PATH` 文件必须增加 `[chat]`、`[chat.modes.standard]` 和 `[chat.modes.ultra]`，否则服务 readiness 返回 503；
- Chat API 不接受 `llm_profile`、Provider、模型名、temperature 或 reasoning effort 覆盖，这些参数由 ai-service 模式配置控制。

文件上传的已实现范围和后续设计见 [文件上传与 COS 设计](../architecture/file-upload.md)。正式路径和 Schema 以公开 OpenAPI 为准。
