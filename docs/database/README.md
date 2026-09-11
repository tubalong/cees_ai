# 数据库约定

完整表级字段说明和 Navicat 只读查询见 [平台使用、接口与数据库字典](../product/platform-usage-guide.md)。
部门树模型、约束和成员归属见 [组织部门管理](../product/organization-department-management.md)。
项目、项目成员和状态历史见 [项目与项目成员管理](../product/project-management.md)。
任务、执行人、评论、附件和动态见 [项目任务管理](../product/task-management.md)。
公开 Chat 调用与 Token 指标见 [公开 AI 对话链路与 Token 计量](../architecture/public-chat-api-and-token-metering.md)。
通知中心与后台任务见 [通知中心与后台任务](../product/notification-center.md)。
工作台与数据看板见 [工作台与数据看板](../product/dashboard-workbench.md)。

> 新环境使用 `prisma migrate deploy` 按 `0001_init` 到 `0012_dashboard_workbench` 的目录顺序执行迁移；全部迁移完成后与当前 `schema.prisma` 保持一致。

- `apps/api/prisma/schema.prisma` 是数据模型唯一事实源，迁移提交 `prisma/migrations`。
- 新建表和字段必须在同一迁移中使用 `COMMENT ON TABLE`、`COMMENT ON COLUMN` 添加 PostgreSQL 注释；`0003_organization_departments_and_database_comments` 已补齐此前全部业务表和字段注释。
- PostgreSQL/pgvector 与 Redis 的精确镜像标签只在 `infra/database/docker-compose.yml` 维护。
- 向量检索使用 pgvector；扩展由 `0001_init` 在创建向量字段前启用，不使用环境专属初始化 SQL。
- AI 服务对业务库只读；正式写入统一经 NestJS。
- 业务模型落地前，先在此文档维护实体与关系草图。

## 通知中心模型

```text
Tenant
  └── Notification
        └── NotificationRecipient ── User
```

- `notifications` 保存通知正文、渠道、关联资源、租户和可选的租户内 `dedup_key`；
- `notification_recipients` 保存通知接收人、租户和独立的 `read_at` 阅读时间；
- `notifications(tenant_id, dedup_key)` 为唯一约束，空去重键不参与有效去重；
- `notification_recipients(tenant_id, notification_id, user_id)` 保证同一通知不会重复投递给同一用户；
- `0011_notification_center_and_jobs` 增加通知关系外键、未读查询索引、通知读取权限和 PostgreSQL 中文表/字段注释；
- 后台任务不新增任务表，使用 Redis 锁协调多 API 实例，并通过通知模型发送日报提醒。

## 工作台模型

工作台不新增业务表，实时聚合 `projects`、`tasks`、`work_reports`、`meetings`、`meeting_participants`、`notifications` 和 `notification_recipients`。数据范围由当前租户成员上下文以及各业务域的读取权限共同决定。

- `0012_dashboard_workbench` 只新增 `dashboard.read` 权限，并为已有租户角色授予该权限；
- 统计不写入快照表，避免和业务事实源产生不一致；
- 任务统计按任务创建时间筛选，会议和日报的日界线使用 UTC；
- 工作台查询不创建业务审计事件。

## 身份与租户关系

```text
User
  └── TenantMembership
        ├── Tenant
        ├── Department
        └── MembershipRole
              └── Role
```

- User 是内部人员资料，使用 UUID 作为技术主键，邮箱字段暂时保留为可空兼容字段；
- TenantMembership 表示用户在特定租户中的账号、凭证、成员身份和状态；
- 租户账号业务唯一约束为 `tenantId + normalizedAccount`，登录时使用 `tenantCode + account`；
- AuthSession 必须同时绑定 User、Tenant 和 TenantMembership；
- MembershipRole 负责成员与租户角色的关联。

## 平台管理员与邀请

```text
User
├── PlatformAdministrator
│   └── PlatformAuthSession
└── TenantInvitation --accept--> TenantMembership
```

- PlatformAdministrator 是独立于租户 Role 的平台身份，第一期只支持 `SUPER_ADMIN`；
- PlatformAuthSession 使用独立平台 JWT 和 Refresh Token Hash；
- PlatformAdministrator 保存全局唯一平台账号和独立密码、锁定状态；
- TenantInvitation 保存租户账号、Token Hash、过期时间和待分配角色，不保存明文 Token；
- 新租户首位管理员不存在时，Tenant 状态为 `PENDING_ACTIVATION`，接受邀请后切换为 `ACTIVE`；
- PlatformAuditLog 保存无租户上下文的平台登录和跨租户管理事件；
- 迁移 `0002_platform_tenant_administration` 创建上述模型，并为已有 `tenant_admin` 增加账号邀请、账号修改和凭证重置权限。

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

## 基础文件上传模型

```text
UploadSession --COS HEAD 校验通过--> FileObject
```

- `UploadSession` 保存租户、创建成员、幂等键、预期大小与 Content-Type、COS Bucket/Region/对象键、过期时间和完成状态；
- `FileObject` 只在 COS 对象校验通过后创建，保存原文件名、用途、存储提供商、Bucket、Region、对象键、大小、Content-Type 和 ETag；
- COS 对象键唯一约束为 `bucket + objectKey`，规范格式是 `cees/{environment}/tenants/{tenantId}/files/{yyyy}/{mm}/{fileId}/source`；
- `0004_redis_cos_upload_foundation` 新增上传会话、文件存储元数据和相关枚举；本期不创建额度预占、租户用量或通用文件绑定表；
- 文件大小使用 PostgreSQL `BIGINT`，API 返回前转换为 JavaScript 安全整数；当前硬上限 500 MiB。

## 项目模型

```text
Project
  ├── ownerMembership -> TenantMembership
  ├── members -> ProjectMember[] -> TenantMembership
  └── statusHistory -> ProjectStatusHistory[]
```

- 项目成员外键指向 `TenantMembership`，不直接使用全局 User；
- 项目编码使用 `tenantId + normalizedCode` 唯一约束；
- `ownerMembershipId` 保存唯一当前负责人，项目成员角色同步为 `OWNER`；
- `project_status_history` 保存每次状态变化及操作者 Membership；
- `0005_project_management` 迁移旧成员关系、项目状态和编码，并为新增结构添加 PostgreSQL 中文注释。

## 任务模型

```text
Project
  └── Task
        ├── parent/children -> Task
        ├── assignees -> TaskAssignee -> TenantMembership
        ├── comments -> TaskComment -> TenantMembership
        ├── attachments -> TaskAttachment -> FileObject
        └── activities -> TaskActivity -> TenantMembership
```

- 任务执行人、评论作者、附件添加者和动态操作者都使用租户 Membership，避免跨租户 User 身份混淆；
- `task_assignees_one_owner_key` 部分唯一索引保证每个有效任务关系集合只有一个负责人；
- `task_attachments_active_file_key` 保证同一有效任务不能重复关联同一文件；
- `tasks.parent_id` 自关联支持父子任务，业务层限制最多 10 层并禁止循环；
- `0006_task_management` 完成旧字段迁移、外键、索引和任务权限初始化；
- `0007_task_database_comments` 补齐任务相关表和字段的 PostgreSQL 中文注释。

## 9. 日报与周报模型

```text
WorkReport
  |-- authorMembership/reviewerMembership -> TenantMembership
  |-- projects -> WorkReportProject -> Project
  `-- tasks -> WorkReportTask -> Task
```

- `work_reports` 保存日报/周报周期、结构化内容、审核人、状态、审核意见和乐观锁版本；
- `work_report_projects` 与 `work_report_tasks` 保存报告的项目和任务关联，并使用租户字段隔离；
- `0010_work_report_management` 创建三张新表、索引、有效周期唯一索引和 `work_report.*` 权限；
- 新增表和字段的 PostgreSQL 注释由迁移文件保存。

## 10. 会议模型

```text
Meeting
  ├── organizerMembership -> TenantMembership
  ├── project -> Project?
  ├── department -> Department?
  ├── participants -> MeetingParticipant[] -> TenantMembership
  └── minutes -> MeetingMinutes?
```

- 普通成员只能访问自己组织或参与的会议，部门归属不自动授予访问权；
- `meeting_participants` 使用租户 Membership，分别保存参会角色、邀请应答和实际出席状态；
- `meeting_minutes.meeting_id` 唯一，一场会议只有一份纪要，并保存记录人、发布人和发布时间；
- `0008_meeting_management` 兼容迁移旧会议占位结构，新增枚举、关系、索引、权限和 PostgreSQL 中文注释；
- 已有会议、参会关系和纪要写入由应用层在会议行锁事务中完成；创建关联项目会议时先锁项目行，避免成员关系与会议写入并发冲突；
- 详细规则见 `docs/product/meeting-management.md` 和 `docs/api/meeting-management-api.md`。

## AI 调用计量模型

```text
Tenant + User + TenantMembership
  └── AIInvocationLog
        ├── conversationId（客户端本地会话）
        ├── turnId（客户端本地轮次）
        └── input/output/total Token 与模型执行元数据
```

- 不新建 Conversation 或 Message 表，消息、回答和摘要正文只保存在客户端本地；
- `0009_ai_chat_token_tracking` 只给现有 `AIInvocationLog` 增加可空的 `membershipId/conversationId/turnId`；
- 三个字段对旧 `generic.invoke` 和历史数据保持兼容，不要求回填；
- `membershipId` 是调用发生时的成员身份快照，不设置级联外键，成员移除后历史指标仍保留；
- 同一轮可能包含 `chat.compact` 与 `chat.invoke/chat.stream` 多条真实调用，轮次总 Token 应求和；
- 当前模型只有用量记录，不存在企业套餐、坑位额度、成员额度账户或扣减表。

- `apps/api/prisma/schema.prisma` 是数据模型唯一事实源，迁移提交到 `apps/api/prisma/migrations`。
- `0001_init` 包含 pgvector 扩展和当前 `schema.prisma` 的完整空库结构；共享环境首次执行后，后续结构变化必须新增前向迁移，不再重写该基线。
- 本地 PostgreSQL 与 Redis 由 `infra/database/docker-compose.yml` 和本地开发覆盖启动；Staging 与 Production 数据库部署在各自独立服务器或服务器组，Redis 必须启用密码。
- Staging 与 Production 均使用 PostgreSQL `5432` 和 Redis `6379`；两个环境位于不同服务器并使用独立容器、账号、密码和数据卷。
- 二进制文件不进入数据库，存放于私有腾讯云 COS；数据库只保存对象键、校验值、大小、内容类型和审计元数据。
- ai-service 当前不直接连接业务数据库；正式数据读取、写入和 AI 调用审计统一由 NestJS 处理。
- 未确认的业务实体不得提前加入 Prisma schema。
