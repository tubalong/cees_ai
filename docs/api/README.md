# API 与契约约定

- `packages/contracts/openapi/openapi.yaml` 是公开 API 的唯一事实源。
- 客户端请求/响应类型与普通服务一律由契约生成（TS：`packages/api-client`；Dart/Python：各端生成目录），禁止手写平行类型或修改生成物；生成器不支持的协议适配只能复用生成类型并单独维护。
- 变更规则：兼容新增默认可选项并声明默认值；破坏性变更必须提升契约版本，并在此说明迁移方式。
- 统一错误格式、鉴权方式与分页约定先在设计草案中确认，再同步到 OpenAPI 契约。

### 契约版本与迁移

- **0.19.0**：删除 `/api/v1/chat/*` 旧对话接口（invoke / stream / compact），以 `/api/v1/conversations/*` 会话、轮次、事件重放资源重建，并新增工具循环（generate_image / generate_document）与公开图片访问 `GET /api/v1/images/{imageId}`。旧客户端迁移到 `createConversation` / `createTurn` / `replayTurnEvents`；`chat` 相关生成模型与客户端已移除。
- **0.20.0**：新增知识库 CRUD、知识库成员管理和 `READER`/`EDITOR`/`MANAGER` 权限契约；新增 `KnowledgeBase*` Schema 和 9 个公开操作。客户端需要重新生成；文档上传、解析、切片、向量化和 RAG 仍不在本版本范围内。
- **0.21.0**：新增钉钉企业绑定、凭证验证、组织架构和人员镜像同步、同步任务查询，共 8 个公开操作；客户端需要重新生成。考勤、请假、文档、消息和 AI 派发仍不在本版本范围内。
- **0.22.0**：当前开发基线。会话生命周期补全（UpdateConversationRequest、lastTurnAt、version 乐观锁）、多模态图片引用（CreateTurnRequest.imageFileIds）与 `tool_result.resource {type,id}` 稳定资源引用重构。客户端需要重新生成。

## 设计草案

- [IAM、租户、RBAC、ACL 与审计 API 设计草案](iam-authorization-api.md)
- [平台租户管理与租户账号激活](platform-tenant-administration.md)
- [组织部门管理](../product/organization-department-management.md)
- [组织架构与成员批量导入](../product/organization-member-import.md)
- [项目管理 API](project-management-api.md)
- [项目与项目成员管理](../product/project-management.md)
- [任务管理 API](task-management-api.md)
- [项目任务管理](../product/task-management.md)
- [会议管理 API](meeting-management-api.md)
- [会议管理](../product/meeting-management.md)
- [日报与周报 API](work-report-management-api.md)
- [日报与周报管理](../product/work-report-management.md)
- [通知中心 API](notification-center-api.md)
- [知识库管理 API](knowledge-base-api.md)
- [通知中心与后台任务](../product/notification-center.md)
- [工作台与数据看板 API](dashboard-api.md)
- [工作台与数据看板](../product/dashboard-workbench.md)
- [Assistant / Conversation API](assistant-api.md)
- [公开 AI 对话链路与 Token 计量](../architecture/public-chat-api-and-token-metering.md)
- [用户个人资料管理](../product/user-profile-management.md)
- [钉钉组织架构与人员同步 API](dingtalk-organization-sync-api.md)
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

POST /api/v1/conversations
GET  /api/v1/conversations
GET  /api/v1/conversations/{conversationId}
PATCH /api/v1/conversations/{conversationId}
DELETE /api/v1/conversations/{conversationId}?version={version}
POST /api/v1/conversations/{conversationId}/turns
GET  /api/v1/conversations/{conversationId}/turns/{turnId}/events
POST /api/v1/conversations/{conversationId}/turns/{turnId}/cancel
GET  /api/v1/images/{imageId}

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
GET    /api/v1/documents/{documentId}/export

GET    /api/v1/resources/{resourceId}/acl
POST   /api/v1/resources/{resourceId}/acl
DELETE /api/v1/resources/{resourceId}/acl/{aclEntryId}?version={version}

GET /api/v1/audit-events
GET /api/v1/audit-events/{auditEventId}

GET    /api/v1/work-reports
POST   /api/v1/work-reports/daily
POST   /api/v1/work-reports/weekly
GET    /api/v1/work-reports/statistics
GET    /api/v1/work-reports/{workReportId}
PATCH  /api/v1/work-reports/{workReportId}
DELETE /api/v1/work-reports/{workReportId}?version={version}
POST   /api/v1/work-reports/{workReportId}/submit
POST   /api/v1/work-reports/{workReportId}/withdraw
POST   /api/v1/work-reports/{workReportId}/review

GET    /api/v1/meetings
POST   /api/v1/meetings
GET    /api/v1/meetings/{meetingId}
PATCH  /api/v1/meetings/{meetingId}
DELETE /api/v1/meetings/{meetingId}?version={version}
POST   /api/v1/meetings/{meetingId}/transitions
GET    /api/v1/meetings/{meetingId}/participants
POST   /api/v1/meetings/{meetingId}/participants
PATCH  /api/v1/meetings/{meetingId}/participants/{membershipId}
DELETE /api/v1/meetings/{meetingId}/participants/{membershipId}?version={version}
PATCH  /api/v1/meetings/{meetingId}/participants/me/response
GET    /api/v1/meetings/{meetingId}/minutes
PUT    /api/v1/meetings/{meetingId}/minutes
POST   /api/v1/meetings/{meetingId}/minutes/publish
POST   /api/v1/meetings/{meetingId}/minutes/reopen

GET    /api/v1/notifications
GET    /api/v1/notifications/unread-count
POST   /api/v1/notifications/read-all
POST   /api/v1/notifications/{notificationId}/read

GET    /api/v1/dashboard/overview
GET    /api/v1/dashboard/task-statistics
GET    /api/v1/dashboard/todos
GET    /api/v1/dashboard/upcoming-meetings

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

GET    /api/v1/projects/{projectId}/tasks
POST   /api/v1/projects/{projectId}/tasks
GET    /api/v1/projects/{projectId}/tasks/{taskId}
PATCH  /api/v1/projects/{projectId}/tasks/{taskId}
DELETE /api/v1/projects/{projectId}/tasks/{taskId}?version={version}
POST   /api/v1/projects/{projectId}/tasks/{taskId}/transitions
PUT    /api/v1/projects/{projectId}/tasks/{taskId}/assignees
GET    /api/v1/projects/{projectId}/tasks/{taskId}/comments
POST   /api/v1/projects/{projectId}/tasks/{taskId}/comments
PATCH  /api/v1/projects/{projectId}/tasks/{taskId}/comments/{commentId}
DELETE /api/v1/projects/{projectId}/tasks/{taskId}/comments/{commentId}?version={version}
GET    /api/v1/projects/{projectId}/tasks/{taskId}/attachments
POST   /api/v1/projects/{projectId}/tasks/{taskId}/attachments
DELETE /api/v1/projects/{projectId}/tasks/{taskId}/attachments/{attachmentId}?version={version}
GET    /api/v1/projects/{projectId}/tasks/{taskId}/activities
```

截至 2026-09-11，身份、本人密码修改、用户个人资料、租户、组织部门、项目、任务、会议、日报周报、通知中心、工作台、RBAC、ACL、审计、平台租户管理、租户账号激活、COS 基础上传和公开 AI 对话接口均已实现。

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
- DOCX 导出（`GET /documents/{documentId}/export`）复用 `document.read` 权限，是同一文档资源的交付视图而不是独立资源；文件由生成时落库的 `document_spec` 经 ai-service 确定性渲染，不调用 LLM。

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

## 0.13.0 迁移说明

- 公开契约版本由 `0.12.0` 提升为 `0.13.0`；
- 新增任务 CRUD、执行人整体替换、状态流转、评论、附件和动态共 15 个接口；
- 任务访问必须是实际项目成员，`project.manage_all` 不绕过任务项目成员边界；
- 新增 `task.*` 权限、任务唯一负责人约束和成员身份外键；
- 项目完成、取消、归档后任务域只读，承担未完成任务的成员不能直接移出项目；
- 新增 Prisma 迁移 `0006_task_management` 和 `0007_task_database_comments`，TypeScript 客户端已经重新生成。

## 0.13.1 迁移说明

- 公开契约版本由 `0.13.0` 提升为 `0.13.1`；
- 任务动态列表的 `limit` 默认值统一为 `20`，与 NestJS DTO 和其他普通分页接口一致；
- `CreateTaskRequest.priority` 明确声明默认值为 `MEDIUM`；
- 本次不改变服务端实际行为，不需要新增 Prisma migration，TypeScript 客户端需要重新生成。

## 0.14.0 迁移说明

- 公开契约版本由 `0.13.1` 提升为 `0.14.0`；
- 兼容新增会议 CRUD、状态流转、参会人管理、邀请应答和会议纪要共 15 个接口；
- 新增 `meeting.*` 权限，普通成员仅能访问自己组织或参与的会议，`meeting.manage_all` 扩展到当前租户全部会议；
- 新增 Prisma 迁移 `0008_meeting_management`，兼容改造旧会议占位表并补齐 PostgreSQL 中文注释；
- 会议、参会人和纪要分别使用乐观锁，全部写操作先获取会议行锁并在同一事务写审计；
- TypeScript 客户端已经重新生成；本版本不包含 COS 会议附件、通知提醒和第三方会议平台集成。

## 0.15.0 迁移说明

- 公开契约版本由 `0.14.0` 提升为 `0.15.0`；
- 新增 `POST /chat/invoke`、`POST /chat/stream` 和 `POST /chat/compact`；
- 客户端只提交本地会话 ID、轮次 ID、模式、摘要和消息，租户/用户/成员身份由 API 注入；
- 非流式响应使用统一 JSON 包络，流式响应为 `text/event-stream`；
- `packages/api-client` 已重新生成；POST SSE 使用非生成入口 `@cees/api-client/chat-stream` 增量读取，且不会自动重连；
- 新增 Prisma 迁移 `0009_ai_chat_token_tracking`，只兼容扩展现有 `ai_invocation_logs`，不创建会话或消息表；
- ai-service 内部契约兼容升级到 `0.2.0`，错误体只在模型已实际执行后可选返回 `execution`，用于避免失败调用漏计 Token；
- 本版只记录企业、成员、会话、轮次和 Token 指标，不包含额度分配、扣减或超额拦截。

## 0.16.0 迁移说明

- 公开契约版本由 `0.15.0` 提升为 `0.16.0`；
- 公开 `/chat/stream` 的 `ChatStreamEvent` 兼容新增 `tool_call` 与 `tool_result` 事件，`ChatStreamPhase` 新增 `tool_executing`；
- 新增公开接口 `GET /images/{imageId}`，用于获取 AI 生成图片的元数据与短期访问 URL；
- ai-service 内部契约新增 `POST /internal/v1/chat/tool-turn/stream`，用于单次带工具能力的模型回合，ai-service 只解析 Tool Call，不执行工具；
- ai-service 内部契约新增 `POST /internal/v1/images/generate`，返回 JSON envelope：Base64 图片字节、`content_type` 以及含 `token_usage` 的执行元数据，不创建正式资源；
- 既有 `invokeChat`、`streamChat` 和 `compactChat` 请求与事件结构保持不变；
- 本次只改契约并重新生成客户端，不包含 Prisma 迁移和服务端行为实现。

## 0.17.0 迁移说明（历史草稿，未发布；实际发布版本见顶部“契约版本与迁移” 0.19.0）

- 本节为开发期间的会话重建草稿，内容已合并进 0.19.0 正式说明，保留仅作过程记录；
- 公开契约版本由 `0.16.0` 提升为 `0.17.0`（草稿版本号，最终发布为 `0.19.0`），删除 `POST /chat/invoke`、`POST /chat/stream` 和 `POST /chat/compact`；开发阶段无兼容客户端，不保留旧路径；
- 会话改为服务端权威：新增 `POST/GET /conversations`、`GET /conversations/{id}`，Conversation/Message/摘要存入 PostgreSQL，客户端本地仅保留渲染缓存；
- 新增 `POST /conversations/{id}/turns`（`Idempotency-Key` 必填，SSE 事件流，客户端只提交本轮消息）与 `GET /conversations/{id}/turns/{turnId}/events?afterSeq=N` 事件重放；
- 新增 `POST /conversations/{id}/turns/{turnId}/cancel` 显式取消；断线只解除订阅不取消执行；
- 所有 SSE 事件更名为 `TurnStreamEvent` 联合并携带递增 `seq`；0.16.0 定义的 `tool_call`/`tool_result` 事件结构与 `tool_executing` 阶段照搬保留，待工具阶段启用；
- 历史压缩改为 Turn 编排内自动触发，不再暴露独立公开接口；
- Prisma 新增 `0011_assistant_conversations` 迁移：`conversations`、`conversation_messages`、`conversation_summaries`、`assistant_turns`、`assistant_events`；
- 后端实现见 [AI 助手工具循环](../architecture/assistant-tool-loop.md)。

## 工具阶段启用说明（2026-09-11）

- 公开契约版本不变（0.16.0 已定义的 `tool_call`/`tool_result` 事件结构沿用，`tool_executing` 阶段未启用）；
- 会话 SSE 事件 `tool_call`（toolCallId/name/arguments）与 `tool_result`（toolCallId/status: completed|failed|rejected/resource/error）正式启用；`generate_image` 与 `generate_document` 工具执行的产物落在稳定资源引用 `resource {type,id}`，访问 URL 通过对应资源接口按需获取；
- 权限目录新增 `ai.image.generate`（调用 AI 生成图片）与 `ai.document.generate`（调用 AI 生成文档），与既有 RBAC 权限同体系，由管理员经角色授予；
- Prisma 新增 `0012_ai_tool_loop_image` 迁移：`tool_calls`（含 upstreamCallId 上游调用 ID 映射、ToolCallStatus 状态机）、`managed_images`，`ResourceType` 新增 `IMAGE`，`FilePurpose` 新增 `GENERATED_IMAGE`，`conversation_messages`/`ai_action_drafts` 增加 `tool_call_id`；文档生成复用既有 `Resource(DOCUMENT)`/`ManagedDocument`，无新增迁移；
- 公开事件无破坏性变更，客户端无需重新生成；工具轮次行为详见 [AI 助手工具循环](../architecture/assistant-tool-loop.md)，文档生成落地详见 [通用文档生成](../architecture/document-generation.md)。
<<<<<<< HEAD
## 图片工具结果返回 URL 说明（2026-09-14）

- 公开 `tool_result` 事件新增兼容可选字段 `resourceUrl`：`generate_image` 执行成功时携带生成时签发的短期可下载 URL（TTL 与 `TENCENT_COS_SIGNED_URL_TTL_SECONDS` 一致），客户端可直接下载/展示图片，无需再经 `GET /images/{imageId}` 查询；
- 回喂模型的工具结果摘要同样携带该 URL（含有效时长提示），模型可直接把地址展示给用户；
- 稳定资源引用 `resource {type,id}` 保留；`resourceUrl` 有时效性，过期后经 `GET /images/{imageId}` 重新获取；非图片资源或失败/拒绝事件该字段为 `null`；
- 字段为兼容新增（可选），老客户端无需改造即可继续使用既有 `resource` 字段。

## 工具回喂内容脱敏说明（2026-09-15）

- 回喂模型的工具结果摘要只放用户关心的信息，不携带系统内部标识（资源 ID、模型名），避免模型原样转述给用户；内部标识仅保留在 `resource {type,id}` 结构化字段与事件中；

=======
## 文档 DOCX 导出说明（2026-09-14）

- 公开契约兼容新增 `GET /api/v1/documents/{documentId}/export`（版本仍为开发基线 0.22.0），返回 DOCX 附件（标准 DOCX MIME，ASCII fallback 与 RFC 5987 UTF-8 文件名）；TypeScript 客户端已重新生成；
- 导出复用 `document.read` 权限与既有 Resource(DOCUMENT) 授权模型，不新增独立权限码；手工创建或内容被手工修改的文档没有落库的 `document_spec`，导出返回 400 明确错误；
- Prisma 新增 `0023_document_docx_export` 迁移：`managed_documents` 增加 `document_spec` JSONB 列，保存 ai-service compose 返回的结构化 DocumentSpec 作为导出事实源；
- 内部链路：NestJS 网关 `renderDocumentDocx` 调用 `POST /internal/v1/documents/render-docx` 确定性渲染（不调用 LLM）；`generateDocumentDocx`（compose+render）仅透传保留，业务不调用以避免重复 LLM 生成；
>>>>>>> de60969 (feat(api): 文档导出 DOCX（render-docx 渲染 + document_spec 落库）)

## 契约事实源

- `packages/contracts/openapi/openapi.yaml` 是 NestJS 公开 API 的事实源。
- `packages/contracts/openapi/ai-service.openapi.yaml` 是 NestJS 调用 ai-service 的内部契约。
- 桌面端和移动端不得调用 ai-service 的通用 invoke 或 stream。
- ai-service Chat 与文档接口同样只供 NestJS 内部调用；客户端不得绕过业务权限直接 chat、compact、compose 或 render。
- Chat 客户端自会话/轮次模型（0.19.0）起只提交本轮消息，历史与摘要由服务端加载；旧版“客户端本地保存会话”模式已随 `/chat/*` 一并移除。
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
