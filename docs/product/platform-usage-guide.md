# CEES AI 平台使用、接口与数据库字典

> 状态：按当前实现整理  
> 最后同步：2026-09-09
> 公开契约版本：`0.12.0`
> 事实源：`packages/contracts/openapi/openapi.yaml`、`apps/api/prisma/schema.prisma`

## 1. 文档用途

本文面向本地开发、接口联调、产品验收和数据库排查，统一说明：

- 平台超级管理员、租户管理员和普通成员的区别；
- 当前已经实现的 84 个 HTTP 操作；
- 路径参数、查询参数和 JSON 请求体字段的含义；
- PostgreSQL 中 41 张业务表、470 个业务字段及 Prisma 迁移表的用途；
- 租户创建、成员激活、登录、授权、资源访问、审计、停用和恢复的整体流转；
- 哪些能力已经有公开 API，哪些目前只有数据库结构或模块占位。

本文是使用说明和数据字典，不替代 OpenAPI 契约。接口行为冲突时，以 `packages/contracts/openapi/openapi.yaml` 为准；数据库字段冲突时，以 `apps/api/prisma/schema.prisma` 和已提交迁移为准。

## 2. 当前实现范围

| 领域 | 当前状态 | 说明 |
| --- | --- | --- |
| 平台管理员认证 | 已实现 | 独立账号、JWT、Refresh Token 和 Session |
| 本人密码修改 | 已实现 | 租户成员与平台管理员校验当前密码后修改，并撤销其他会话 |
| 平台租户管理 | 已实现 | 创建、查询、修改、停用、恢复和租户管理员维护 |
| 租户成员认证 | 已实现 | `tenantCode + account + password` 登录、刷新、退出和身份查询 |
| 用户个人资料 | 已实现 | 查询当前租户资料并由成员自行修改展示名 |
| 成员邀请与激活 | 已实现 | 一次性激活令牌、账号建议、账号修改和凭证重置 |
| 租户与成员管理 | 已实现 | 当前租户、成员查询、状态修改、移除和角色分配 |
| RBAC | 已实现 | 权限目录、角色管理、权限替换和数据范围 |
| Managed Document | 已实现 | 受控文档创建、查询、修改和软删除 |
| Resource ACL | 已实现 | 按成员或角色授予文档级权限 |
| 租户与平台审计 | 已实现 | 分域记录和查询操作审计 |
| 组织部门管理 | 已实现 | 部门树、增删改、启停、成员列表和成员调部门 |
| 组织人员批量导入 | 已实现 | 前端解析 Excel，后端校验并事务创建部门、待激活成员、角色和一次性激活凭证 |
| 文件上传 | 基础接口已实现 | 通过短时预签名 PUT URL 直传私有 COS，HEAD 校验通过后登记正式文件 |
| 项目与项目成员 | 已实现 | 项目 CRUD、成员角色、负责人转移、状态机、完成后只读和归档 |
| 任务、评论、附件和动态 | 仅数据库结构/模块占位 | 项目完成校验已读取任务状态，任务公开 API 尚未实现 |
| 知识库、会议、通知 | 仅数据库结构/设计基础 | 当前没有对应公开 API |
| AI 草稿和调用日志 | 数据结构与内部编排基础 | AI 不能绕过 NestJS 写正式业务数据 |

## 3. 管理员账号到底存在哪里

### 3.1 平台超级管理员

平台超级管理员是独立认证域：

```text
users
  └── platform_administrators
        └── platform_auth_sessions
```

- `platform_administrators` 保存平台账号、密码 Hash、角色、状态和登录锁定信息；
- `users` 保存该管理员对应的内部人员身份和展示名称；
- `platform_auth_sessions` 保存平台登录会话和 Refresh Token Hash；
- 当前平台角色只有 `SUPER_ADMIN`；
- 本地 seed 默认平台账号为 `superadmin`，默认密码为 `change_me`。

### 3.2 租户管理员

租户管理员没有独立的 `tenant_administrators` 表，而是普通租户成员被分配了系统角色 `tenant_admin`：

```text
users
  └── tenant_memberships
        └── membership_roles
              └── roles(code = tenant_admin)
                    └── role_permissions
                          └── permissions
```

- `tenant_memberships` 保存租户内账号、密码 Hash、成员状态和部门；
- `roles` 中 `code = tenant_admin`、`is_system = true` 表示租户系统管理员角色；
- `membership_roles` 表示某个成员拥有某个角色；
- `role_permissions` 表示角色拥有的权限；
- 本地 seed 默认租户编码为 `cees`，租户管理员账号为 `admin`，默认密码为 `change_me`。

## 4. 本地使用入口

### 4.1 服务地址

| 服务 | 地址 |
| --- | --- |
| NestJS API | `http://localhost:3000/api/v1` |
| Swagger | `http://localhost:3000/api/docs` |
| API 健康检查 | `http://localhost:3000/api/v1/health` |
| PostgreSQL | `127.0.0.1:5432` |
| Redis | `127.0.0.1:6379` |

### 4.2 本地数据库连接

| Navicat 配置 | 值 |
| --- | --- |
| 类型 | PostgreSQL |
| 主机 | `127.0.0.1` |
| 端口 | `5432` |
| 数据库 | `cees_ai_dev` |
| 用户名 | `cees_dev` |
| 密码 | `change_me` |
| Schema | `public` |
| SSL | 本地可关闭 |

### 4.3 启动顺序

```cmd
cd /d D:\IEDAPROJECT\cees_ai
pnpm infra:up
set DATABASE_URL=postgresql://cees_dev:change_me@localhost:5432/cees_ai_dev?schema=public
pnpm --filter @cees/api prisma:generate
pnpm --filter @cees/api exec prisma migrate deploy
pnpm --filter @cees/api prisma:seed
pnpm --filter @cees/api dev
```

开发模式只应启动一份 API。出现 `EADDRINUSE :::3000` 时，表示已有进程占用端口，不要继续重复启动。

## 5. API 通用约定

### 5.1 鉴权域

- 租户接口使用租户 Access Token：`Authorization: Bearer <accessToken>`；
- 平台接口使用平台 Access Token，虽然请求头形式相同，但 Token、Session、Guard 和权限域完全独立；
- `/health`、租户登录、平台登录、刷新和邀请激活是公开接口；
- Refresh Token 采用单次轮换，刷新成功后旧 Refresh Token 立即失效；
- 退出登录会撤销数据库 Session，之后旧 Access Token 即使尚未自然过期也不能继续访问受保护接口。

### 5.2 成功与失败格式

普通成功响应：

```json
{
  success: true,
  data: {},
  requestId: request-id
}
```

失败响应：

```json
{
  success: false,
  error: {
    code: ERROR_CODE,
    message: 错误说明,
    details: {}
  },
  requestId: request-id
}
```

`204 No Content` 接口没有响应体。

### 5.3 乐观锁 `version`

可修改资源通常带有整数 `version`。调用方必须提交读取到的当前版本：

1. 查询资源得到 `version = 3`；
2. 修改或删除时提交 `version = 3`；
3. 成功后服务端把版本提升为 `4`；
4. 其他客户端继续提交旧版本时返回 `409`，防止覆盖新数据。

### 5.4 游标分页

- `limit`：本次最多返回数量；普通列表默认 `20`，租户审计默认 `50`，最大均为 `100`；
- `cursor`：上一页返回的 `nextCursor`；首次请求不传；
- `nextCursor = null`：已经没有下一页；
- 当前游标为 UUID，不应由客户端自行拼装或解析业务含义。

## 6. 接口清单

以下路径均相对于 `/api/v1`。

### 6.1 系统、租户认证与个人资料

| 方法与路径 | 用途 | 参数/请求体 | 返回 | 鉴权 |
| --- | --- | --- | --- | --- |
| `GET /health` | 检查 NestJS 进程是否存活 | 无 | 服务状态 | 公开 |
| `POST /auth/login` | 使用租户编码、账号和密码登录 | `LoginRequest` | Token、用户、租户和成员身份 | 公开 |
| `POST /auth/refresh` | 轮换租户 Access/Refresh Token | `RefreshTokenRequest` | 新 Token 对 | 公开 |
| `POST /auth/activate` | 使用邀请令牌设置密码并激活成员 | `AcceptTenantInvitationRequest` | 租户和成员信息 | 公开 |
| `POST /auth/logout` | 撤销当前租户 Session | 无 | `204` | 租户 Bearer |
| `GET /auth/me` | 查询当前用户、租户、角色和实时权限 | 无 | `MeResponse` | 租户 Bearer |
| `POST /auth/change-password` | 修改当前租户成员密码并撤销其他会话 | `ChangePasswordRequest` | `204` | 租户 Bearer |
| `GET /users/me/profile` | 查询当前租户内的个人资料 | 无 | `UserProfile` | 租户 Bearer |
| `PATCH /users/me/profile` | 修改当前租户内的展示名 | `UpdateUserProfileRequest` | 修改后的 `UserProfile` | 租户 Bearer |

个人资料修改不需要额外 RBAC 权限，但只能修改当前 Access Token 对应的成员资料。账号、部门、成员状态和角色仍由租户管理员接口管理。

### 6.2 当前租户与成员

| 方法与路径 | 用途 | 参数/请求体 | 返回 | 权限 |
| --- | --- | --- | --- | --- |
| `GET /tenants/current` | 获取当前 Token 对应租户 | 无 | `TenantDetail` | `tenant.read` |
| `PATCH /tenants/current` | 修改当前租户名称 | `UpdateTenantRequest` | 修改后的租户 | `tenant.update` |
| `GET /tenants/current/members` | 分页查询成员 | `keyword/status/roleId/limit/cursor` | 成员列表 | `member.read` |
| `GET /tenants/current/members/{membershipId}` | 查询单个成员 | `membershipId` | 成员详情 | `member.read` |
| `PATCH /tenants/current/members/{membershipId}` | 修改展示名、部门或成员状态 | 路径 ID + `UpdateTenantMemberRequest` | 修改后的成员 | `member.update`；修改部门还需 `department.member.assign` |
| `DELETE /tenants/current/members/{membershipId}` | 将成员从当前租户移除并撤销会话 | `membershipId` | `204` | `member.remove` |
| `PUT /tenants/current/members/{membershipId}/roles` | 用新角色集合整体替换成员角色 | 路径 ID + `ReplaceTenantMemberRolesRequest` | 修改后的成员 | `role.assign` |
| `POST /tenants/current/account-suggestions` | 根据姓名生成可用拼音账号建议 | `AccountSuggestionRequest` | 建议账号及备选 | `member.invite` |
| `PATCH /tenants/current/members/{membershipId}/account` | 修改成员登录账号并撤销其旧会话 | 路径 ID + `UpdateTenantMemberAccountRequest` | 修改后的成员 | `member.account.update` |
| `POST /tenants/current/members/{membershipId}/credential-reset` | 清空旧凭证并签发一次性激活令牌 | `membershipId` | 邀请及只返回一次的令牌 | `member.credential.reset` |

限制说明：不能移除自己，不能移除或重置最后一名有效租户管理员；账号修改和凭证重置都会撤销目标成员已有 Session。

### 6.3 组织部门管理

| 方法与路径 | 用途 | 参数/请求体 | 返回 | 权限 |
| --- | --- | --- | --- | --- |
| `GET /tenants/current/departments` | 查询部门树 | 可选 `status` | `DepartmentTree` | `department.read` |
| `POST /tenants/current/departments` | 创建部门 | `CreateDepartmentRequest` | 新部门 | `department.create` |
| `GET /tenants/current/departments/{departmentId}` | 查询部门详情 | `departmentId` | 部门详情 | `department.read` |
| `PATCH /tenants/current/departments/{departmentId}` | 修改、移动或启停部门 | 路径 ID + `UpdateDepartmentRequest` | 修改后的部门 | `department.update` |
| `DELETE /tenants/current/departments/{departmentId}` | 删除空部门 | 路径 ID + 查询参数 `version` | `204` | `department.delete` |
| `GET /tenants/current/departments/{departmentId}/members` | 分页查询部门成员 | `keyword/status/limit/cursor` | 成员列表 | `department.read`、`member.read` |
| `PUT /tenants/current/members/{membershipId}/department` | 调整成员所属部门 | `AssignTenantMemberDepartmentRequest` | 修改后的成员 | `department.member.assign` |
| `POST /tenants/current/organization-imports/validate` | 校验组织架构和成员导入数据，不落库 | `OrganizationImportRequest` | 部门创建/复用预览、成员有效角色和逐项问题 | `department.create`、`member.invite`、`role.assign` |
| `POST /tenants/current/organization-imports/confirm` | 重新校验并事务导入 | `OrganizationImportRequest` | 部门结果和只返回一次的成员激活凭证 | `department.create`、`member.invite`、`role.assign` |

部门最大 10 级，同级名称唯一，禁止父子循环；部门有子部门或成员时不能删除，只能向启用部门分配成员。

批量导入由前端解析 Excel，后端只接收标准 JSON。单批最多 200 个部门、500 名成员，请求体最大 2 MiB。已有且启用的完整部门路径会复用，不更新已有部门资料；已停用部门、重复账号、有效待处理邀请、无效角色和循环层级都会阻止确认导入。第一版只创建新成员，并禁止批量分配 `tenant_admin`。

### 6.4 项目与项目成员

| 方法与路径 | 用途 | 参数/请求体 | 返回 | 权限与范围 |
| --- | --- | --- | --- | --- |
| `GET /projects` | 查询当前成员可见项目 | `keyword/status/departmentId/ownerMembershipId/includeArchived/limit/cursor` | 项目列表 | `project.read` + 项目成员或 `project.manage_all` |
| `POST /projects` | 创建项目并设置负责人 | `CreateProjectRequest` | 新项目 | `project.create` |
| `GET /projects/{projectId}` | 查询项目详情 | `projectId` | 项目详情 | `project.read` + 项目范围 |
| `PATCH /projects/{projectId}` | 修改非只读项目资料 | 路径 ID + `UpdateProjectRequest` | 修改后的项目 | `project.update` + OWNER/MANAGER |
| `DELETE /projects/{projectId}` | 软删除无任务项目 | 路径 ID + 查询参数 `version` | `204` | `project.delete` + OWNER |
| `GET /projects/{projectId}/members` | 查询项目成员 | `projectId` | 成员列表 | `project.member.read` + 项目范围 |
| `POST /projects/{projectId}/members` | 添加项目成员 | `AddProjectMemberRequest` | 项目成员 | `project.member.manage` + OWNER/MANAGER |
| `PATCH /projects/{projectId}/members/{membershipId}` | 修改 MANAGER/MEMBER 角色 | 路径 ID + `UpdateProjectMemberRequest` | 项目成员 | `project.member.manage` + OWNER/MANAGER |
| `DELETE /projects/{projectId}/members/{membershipId}` | 移除非负责人 | 路径 ID + 查询参数 `version` | `204` | `project.member.manage` + OWNER/MANAGER |
| `PUT /projects/{projectId}/owner` | 转移唯一负责人 | `TransferProjectOwnerRequest` | 项目详情 | `project.member.manage` + OWNER |
| `POST /projects/{projectId}/start` | `PLANNING → ACTIVE` | `ProjectVersionRequest` | 项目详情 | `project.update` + OWNER/MANAGER |
| `POST /projects/{projectId}/pause` | `ACTIVE → PAUSED` | `ProjectVersionRequest` | 项目详情 | `project.update` + OWNER/MANAGER |
| `POST /projects/{projectId}/resume` | `PAUSED → ACTIVE` | `ProjectVersionRequest` | 项目详情 | `project.update` + OWNER/MANAGER |
| `POST /projects/{projectId}/complete` | 完成项目并进入只读 | `CompleteProjectRequest` | 项目详情 | `project.complete` + OWNER |
| `POST /projects/{projectId}/reopen` | `COMPLETED → ACTIVE` | `ProjectReasonRequest` | 项目详情 | `project.reopen` + OWNER |
| `POST /projects/{projectId}/cancel` | 取消未完成项目 | `ProjectReasonRequest` | 项目详情 | `project.update` + OWNER/MANAGER |
| `POST /projects/{projectId}/archive` | `COMPLETED → ARCHIVED` | `ProjectVersionRequest` | 项目详情 | `project.archive` + OWNER |
| `POST /projects/{projectId}/restore` | `ARCHIVED → COMPLETED` | `ProjectVersionRequest` | 项目详情 | `project.archive` + OWNER |

同租户不自动获得项目访问权。部门只用于归属和筛选；完成、取消和归档项目禁止修改资料与成员。详细规则见 [项目与项目成员管理](project-management.md)。

### 6.5 成员邀请

| 方法与路径 | 用途 | 参数/请求体 | 返回 | 权限 |
| --- | --- | --- | --- | --- |
| `GET /tenants/current/invitations` | 查询当前租户邀请 | `status/limit/cursor` | 邀请列表 | `member.invite` |
| `POST /tenants/current/invitations` | 创建成员账号邀请 | `CreateTenantInvitationRequest` | 邀请和一次性令牌 | `member.invite` |
| `DELETE /tenants/current/invitations/{invitationId}` | 撤销尚未使用的邀请 | `invitationId` | `204` | `member.invite` |

邀请令牌只在创建或凭证重置响应中返回一次，数据库仅保存令牌 Hash。调用方必须通过受控渠道交付 `tenantCode + account + invitationToken`。

### 6.6 RBAC

| 方法与路径 | 用途 | 参数/请求体 | 返回 | 权限 |
| --- | --- | --- | --- | --- |
| `GET /permissions` | 获取平台预置的租户权限目录 | 无 | 权限列表 | `role.read` |
| `GET /roles` | 分页查询当前租户角色 | `keyword/limit/cursor` | 角色列表 | `role.read` |
| `POST /roles` | 创建租户自定义角色 | `CreateRoleRequest` | 新角色 | `role.create` |
| `GET /roles/{roleId}` | 获取角色、权限和成员数量 | `roleId` | 角色详情 | `role.read` |
| `PATCH /roles/{roleId}` | 修改角色名称、描述或数据范围 | 路径 ID + `UpdateRoleRequest` | 修改后的角色 | `role.update` |
| `DELETE /roles/{roleId}` | 删除未被成员或 ACL 使用的自定义角色 | `roleId` + 查询参数 `version` | `204` | `role.delete` |
| `PUT /roles/{roleId}/permissions` | 整体替换角色权限集合 | 路径 ID + `ReplaceRolePermissionsRequest` | 修改后的角色 | `role.update` |

`tenant_admin` 是系统角色，不能通过公开接口修改、替换权限或删除。

### 6.7 Managed Document 与资源 ACL

| 方法与路径 | 用途 | 参数/请求体 | 返回 | 权限 |
| --- | --- | --- | --- | --- |
| `GET /documents` | 查询当前成员实际可读的受控文档 | `keyword/visibility/limit/cursor` | 文档摘要列表 | `document.read` + 资源范围 |
| `POST /documents` | 创建受控文档，同时创建授权根资源 | `CreateDocumentRequest` | 文档详情 | `document.create` |
| `GET /documents/{documentId}` | 获取授权范围内的文档正文 | `documentId` | 文档详情 | `document.read` + 资源范围 |
| `PATCH /documents/{documentId}` | 修改授权范围内文档 | 路径 ID + `UpdateDocumentRequest` | 修改后的文档 | `document.update` + 资源范围 |
| `DELETE /documents/{documentId}` | 软删除文档、资源和关联 ACL | `documentId` + 查询参数 `version` | `204` | `document.delete` + 资源范围 |
| `GET /resources/{resourceId}/acl` | 查询资源级授权 | `resourceId` | ACL 列表 | `document.share` + 资源范围 |
| `POST /resources/{resourceId}/acl` | 给成员或角色授予资源权限 | 路径 ID + `CreateResourceAclRequest` | 新 ACL | `document.share` + 资源范围 |
| `DELETE /resources/{resourceId}/acl/{aclEntryId}` | 撤销一条资源授权 | 两个路径 ID + 查询参数 `version` | `204` | `document.share` + 资源范围 |

最终文档访问权限是以下两部分的交集：

1. RBAC 是否拥有 `document.read/update/delete/share` 操作权限；
2. 是否为资源所有者、是否具有有效成员/角色 ACL、是否拥有 `document.manage_all`，或读取时文档是否为 `TENANT` 可见。

`TENANT` 可见性只扩展读取范围，不自动赋予修改、删除或分享权限。

### 6.8 租户审计

| 方法与路径 | 用途 | 参数 | 返回 | 权限 |
| --- | --- | --- | --- | --- |
| `GET /audit-events` | 在当前租户内组合筛选审计事件 | `action/outcome/actorId/membershipId/resourceType/resourceId/requestId/from/to/limit/cursor` | 审计列表 | `audit.read` |
| `GET /audit-events/{auditEventId}` | 查询当前租户一条审计详情 | `auditEventId` | 审计详情 | `audit.read` |

审计查询始终附带当前 `tenantId`，不能跨租户查询。

### 6.9 平台管理员认证

| 方法与路径 | 用途 | 参数/请求体 | 返回 | 鉴权 |
| --- | --- | --- | --- | --- |
| `POST /platform/auth/login` | 平台管理员独立登录 | `PlatformLoginRequest` | 平台 Token 和管理员身份 | 公开 |
| `POST /platform/auth/refresh` | 轮换平台 Token | `RefreshTokenRequest` | 新 Token 对 | 公开 |
| `POST /platform/auth/logout` | 撤销当前平台 Session | 无 | `204` | 平台 Bearer |
| `GET /platform/auth/me` | 查询平台管理员和平台权限 | 无 | 平台管理员身份 | 平台 Bearer |
| `POST /platform/auth/change-password` | 修改当前平台管理员密码并撤销其他会话 | `ChangePasswordRequest` | `204` | 平台 Bearer |

### 6.10 平台租户管理与平台审计

| 方法与路径 | 用途 | 参数/请求体 | 返回 | 平台权限 |
| --- | --- | --- | --- | --- |
| `GET /platform/tenants` | 分页查询全部租户 | `keyword/status/limit/cursor` | 平台租户列表 | `platform.tenant.read` |
| `POST /platform/tenants` | 创建租户、系统角色和首位管理员邀请 | `CreatePlatformTenantRequest` | 租户和管理员分配结果 | `platform.tenant.create` |
| `GET /platform/tenants/{tenantId}` | 查询租户状态和管理员统计 | `tenantId` | 平台租户详情 | `platform.tenant.read` |
| `PATCH /platform/tenants/{tenantId}` | 修改租户名称 | 路径 ID + `UpdatePlatformTenantRequest` | 修改后的租户 | `platform.tenant.update` |
| `POST /platform/tenants/{tenantId}/suspend` | 停用租户并撤销其全部租户 Session | 路径 ID + `SuspendPlatformTenantRequest` | 停用后的租户 | `platform.tenant.suspend` |
| `POST /platform/tenants/{tenantId}/restore` | 在存在有效管理员时恢复租户 | 路径 ID + `VersionRequest` | 恢复后的租户 | `platform.tenant.restore` |
| `GET /platform/tenants/{tenantId}/administrators` | 查询租户管理员成员 | `tenantId` | 管理员列表 | `platform.tenant.admin.read` |
| `POST /platform/tenants/{tenantId}/administrators` | 将现有成员设为管理员，或创建管理员邀请 | 路径 ID + `AssignPlatformTenantAdministratorRequest` | `ASSIGNED` 或 `INVITED` | `platform.tenant.admin.assign` |
| `DELETE /platform/tenants/{tenantId}/administrators/{membershipId}` | 取消成员的租户管理员角色 | 两个路径 ID | `204` | `platform.tenant.admin.remove` |
| `GET /platform/audit-events` | 查询平台域审计 | `action/outcome/limit/cursor` | 平台审计列表 | `platform.audit.read` |
| `GET /platform/audit-events/{auditEventId}` | 查询平台审计详情 | `auditEventId` | 平台审计详情 | `platform.audit.read` |

## 7. 请求参数字典

### 7.1 路径与查询参数

| 参数 | 含义 |
| --- | --- |
| `tenantId` | 平台管理场景中的租户 UUID |
| `membershipId` | 用户在某一租户内的成员关系 UUID，不等于 `userId` |
| `projectId` | 当前租户项目 UUID；无项目范围时接口按不存在处理 |
| `roleId` | 当前租户角色 UUID；在成员列表查询中表示只返回拥有该角色的成员 |
| `documentId` | Managed Document UUID，同时也是其 Resource UUID |
| `resourceId` | 统一授权资源 UUID；当前公开资源类型只有文档 |
| `aclEntryId` | 资源 ACL 记录 UUID |
| `auditEventId` | 租户或平台审计记录 UUID |
| `invitationId` | 租户邀请 UUID |
| `keyword` | 模糊搜索关键字；具体匹配字段由对应列表服务决定 |
| `status` | 对应领域状态，如租户、成员或邀请状态 |
| `visibility` | 文档可见性筛选：`PRIVATE` 或 `TENANT` |
| `version` | 当前资源版本，用于乐观锁删除或修改 |
| `action` | 审计动作编码筛选 |
| `outcome` | 审计结果：`SUCCESS` 或 `FAILURE` |
| `actorId` | 租户审计中的操作者 User UUID |
| `resourceType/resourceId` | 按审计资源类型和资源 UUID 筛选 |
| `requestId` | 按一次 HTTP 请求的追踪 ID 筛选 |
| `from/to` | ISO 8601 时间范围起止值 |
| `limit` | 返回条数，范围 `1..100` |
| `cursor` | 上一页响应的 `nextCursor` |
| `includeArchived` | 项目列表是否包含归档项目，默认 `false` |

### 7.2 租户登录和激活请求

#### `LoginRequest`

| 字段 | 必填 | 含义与约束 |
| --- | --- | --- |
| `tenantCode` | 是 | 租户业务编码，2～64 位，以字母或数字开头，可包含 `_`、`-` |
| `account` | 是 | 租户内登录账号，3～32 位英文字母或数字，服务端按小写比较 |
| `password` | 是 | 密码，8～128 位 |
| `deviceName` | 否 | 当前设备名称，1～100 位，用于 Session 识别 |

#### `RefreshTokenRequest`

| 字段 | 必填 | 含义与约束 |
| --- | --- | --- |
| `refreshToken` | 是 | 登录或上次刷新返回的 Refresh Token，32～512 位；成功使用后立即失效 |

#### `ChangePasswordRequest`

| 字段 | 必填 | 含义与约束 |
| --- | --- | --- |
| `currentPassword` | 是 | 当前密码，8～128 位；服务端使用 Argon2 Hash 校验 |
| `newPassword` | 是 | 新密码，8～128 位，不能与当前密码相同 |

同一个请求模型用于以下两个接口：

```text
POST /auth/change-password
POST /platform/auth/change-password
```

- 两个接口都必须携带各自认证域的有效 Access Token；
- 租户成员密码保存在 `tenant_memberships.password_hash`，平台管理员密码保存在 `platform_administrators.password_hash`；
- 修改成功后保留发起请求的当前 Session，撤销同一租户成员身份或同一平台管理员身份的其他未撤销 Session；
- 成功修改会清零登录失败次数和锁定时间，并递增对应身份的 `version`；
- 当前密码错误返回 `401 AUTH_CURRENT_PASSWORD_INVALID`；
- 新密码与当前密码相同返回 `400 AUTH_NEW_PASSWORD_SAME_AS_CURRENT`；
- 租户密码和平台密码相互独立，修改其中一个不会修改另一个认证域的密码。

#### `AcceptTenantInvitationRequest`

| 字段 | 必填 | 含义与约束 |
| --- | --- | --- |
| `tenantCode` | 是 | 被邀请加入的租户编码 |
| `account` | 是 | 邀请中预留的租户账号 |
| `invitationToken` | 是 | 创建邀请或凭证重置时只返回一次的明文令牌 |
| `password` | 是 | 成员要设置的新密码，8～128 位 |

### 7.3 租户和成员请求

#### `UpdateUserProfileRequest`

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `displayName` | 是 | 当前租户内的展示名称，去除首尾空白后长度为 1～120 位 |
| `version` | 是 | 当前 `tenant_memberships.version`；版本不一致返回 `409` |

#### `UpdateTenantRequest`

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `name` | 是 | 新租户名称，1～120 位 |
| `version` | 是 | 当前租户版本 |

#### `UpdateTenantMemberRequest`

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `displayName` | 否 | 租户内展示名称，1～120 位 |
| `departmentId` | 否 | 部门 UUID；传 `null` 表示移出部门 |
| `status` | 否 | `ACTIVE` 或 `DISABLED` |
| `version` | 是 | 当前成员版本 |

#### `ReplaceTenantMemberRolesRequest`

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `roleIds` | 是 | 完整的新角色 UUID 集合，最多 100 个；不是增量追加 |
| `version` | 是 | 当前成员版本 |

#### `AccountSuggestionRequest`

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `displayName` | 是 | 用于生成拼音账号建议的成员姓名，1～120 位 |

#### `UpdateTenantMemberAccountRequest`

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `account` | 是 | 新账号，3～32 位英文字母或数字 |
| `version` | 是 | 当前成员版本 |

#### `CreateTenantInvitationRequest`

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `account` | 否 | 预留账号；不传时服务端根据展示名生成建议账号 |
| `displayName` | 是 | 被邀请成员展示名 |
| `roleIds` | 是 | 激活后要分配的角色 UUID 集合，最多 100 个 |

### 7.4 部门请求

#### `CreateDepartmentRequest`

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `name` | 是 | 部门名称，1～120 字符 |
| `parentId` | 否 | 父部门 UUID；默认 `null`，表示根部门 |
| `description` | 否 | 部门说明，最长 500 字符；默认 `null` |
| `sortOrder` | 否 | 非负排序值，默认 `0`，越小越靠前 |

#### `UpdateDepartmentRequest`

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `name` | 否 | 新部门名称 |
| `parentId` | 否 | 新父部门 UUID；`null` 表示移动为根部门 |
| `description` | 否 | 新说明；`null` 表示清空 |
| `sortOrder` | 否 | 新排序值 |
| `status` | 否 | `ACTIVE` 或 `DISABLED` |
| `version` | 是 | 当前部门版本 |

#### `AssignTenantMemberDepartmentRequest`

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `departmentId` | 是 | 目标部门 UUID；`null` 表示取消部门归属 |
| `version` | 是 | 当前成员版本 |

### 7.5 项目请求

| 请求 | 关键字段 | 说明 |
| --- | --- | --- |
| `CreateProjectRequest` | `code/name`，可选 `description/departmentId/ownerMembershipId/startsAt/endsAt` | 编码 2～32 位，只允许英文、数字、`_`、`-` |
| `UpdateProjectRequest` | 可修改创建字段中的项目资料，必填 `version` | 不允许直接修改状态和负责人 |
| `AddProjectMemberRequest` | `membershipId`，可选 `role` | role 仅 `MANAGER/MEMBER`，默认 `MEMBER` |
| `UpdateProjectMemberRequest` | `role/version` | 负责人不能通过该接口修改 |
| `TransferProjectOwnerRequest` | `membershipId/version` | 目标必须是当前项目的有效成员 |
| `ProjectVersionRequest` | `version` | 启动、暂停、恢复、归档和恢复归档使用 |
| `ProjectReasonRequest` | `reason/version` | 重开或取消项目使用 |
| `CompleteProjectRequest` | `version`，可选 `completionSummary` | 存在未完成任务时拒绝完成 |

### 7.6 角色请求

#### `CreateRoleRequest`

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `code` | 是 | 稳定业务编码，2～64 位，小写字母开头，可包含数字、`_`、`:`、`-` |
| `name` | 是 | 展示名称，1～120 位 |
| `description` | 否 | 角色说明，最多 500 位，可为 `null` |
| `dataScope` | 是 | 数据范围枚举 |

#### `UpdateRoleRequest`

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `name` | 否 | 新展示名称 |
| `description` | 否 | 新说明，可传 `null` 清空 |
| `dataScope` | 否 | 新数据范围 |
| `version` | 是 | 当前角色版本；除 `version` 外至少还要提交一个修改字段 |

#### `ReplaceRolePermissionsRequest`

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `permissionIds` | 是 | 完整的新权限 UUID 集合，最多 100 个 |
| `version` | 是 | 当前角色版本 |

### 7.7 文档与 ACL 请求

#### `CreateDocumentRequest`

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `title` | 是 | 文档标题，1～200 位 |
| `content` | 是 | 文档正文，最多 1,000,000 字符 |
| `visibility` | 是 | `PRIVATE` 或 `TENANT` |

#### `UpdateDocumentRequest`

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `title` | 否 | 新标题 |
| `content` | 否 | 新正文 |
| `visibility` | 否 | 新可见性 |
| `version` | 是 | 当前文档版本；除 `version` 外至少还要提交一个修改字段 |

#### `CreateResourceAclRequest`

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `subjectType` | 是 | `MEMBERSHIP` 表示成员，`ROLE` 表示角色 |
| `subjectId` | 是 | 对应成员或角色 UUID |
| `permissionCodes` | 是 | 1～20 个权限，仅允许 `document.read/update/delete/share` |
| `expiresAt` | 否 | ISO 8601 过期时间；`null` 表示长期有效 |

### 7.8 平台请求

#### `PlatformLoginRequest`

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `account` | 是 | 全局唯一平台账号，3～32 位英文字母或数字 |
| `password` | 是 | 平台密码，8～128 位 |
| `deviceName` | 否 | 平台 Session 的设备名称 |

#### `CreatePlatformTenantRequest`

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `code` | 是 | 租户唯一业务编码 |
| `name` | 是 | 租户名称 |
| `initialAdministrator` | 是 | 首位租户管理员信息 |
| `initialAdministrator.account` | 否 | 首位管理员账号；不传时按姓名生成 |
| `initialAdministrator.displayName` | 是 | 首位管理员展示名称 |

#### 其他平台请求

| 模型 | 字段 | 含义 |
| --- | --- | --- |
| `UpdatePlatformTenantRequest` | `name`、`version` | 修改租户名称并提交当前版本 |
| `SuspendPlatformTenantRequest` | `reason`、`version` | 停用原因 1～500 位及当前版本 |
| `VersionRequest` | `version` | 恢复租户时提交当前版本 |
| `AssignPlatformTenantAdministratorRequest` | `account`、可选 `displayName` | 将已有账号设为管理员，或为不存在账号创建管理员邀请 |

## 8. 核心返回字段

| 返回对象 | 主要字段含义 |
| --- | --- |
| `AuthUser` | `id` 为全局 User UUID；`displayName` 为人员展示名 |
| `AuthTenant` | 当前租户的 `id/code/name` |
| `AuthMembership` | 当前成员的 `id/account/status/roles` |
| `LoginResponse` | Access/Refresh Token、各自有效秒数以及用户、租户、成员上下文 |
| `MeResponse` | 当前用户、租户、成员及实时权限编码数组 |
| `TenantDetail` | 租户 UUID、编码、名称、状态、版本和时间 |
| `TenantMember` | Membership UUID、账号、User、部门、状态、角色、加入时间和版本 |
| `DepartmentSummary` | 部门 UUID、父部门、名称、说明、排序、状态、成员数、子部门数和版本 |
| `DepartmentTreeNode` | `DepartmentSummary` 的全部字段以及递归 `children` 子部门数组 |
| `DepartmentTree` | 当前租户部门树的根节点数组 `items` |
| `ProjectSummary` | 项目编码、状态、负责人、当前成员角色、成员/任务数量、时间和版本 |
| `ProjectMemberSummary` | ProjectMember UUID、Membership UUID、账号、展示名、部门、项目角色和版本 |
| `Role` | 角色编码、名称、描述、数据范围、系统标记、权限、成员数和版本 |
| `DocumentSummary/Detail` | 文档和资源 ID、标题、正文、可见性、所有者、当前有效权限和版本 |
| `ResourceAclEntry` | 授权主体、权限编码、过期时间和版本 |
| `AuditEvent` | 动作、结果、操作者、资源、请求 ID、客户端信息、元数据和时间 |
| `PlatformTenantDetail` | 租户状态、有效管理员数、待处理邀请数、版本和时间 |
| `TenantInvitationCreated` | 邀请详情及只返回一次的 `invitationToken` |

## 9. 权限与状态枚举

### 9.1 租户权限目录

| 权限 | 含义 |
| --- | --- |
| `tenant.read` | 查看当前租户 |
| `tenant.update` | 修改当前租户 |
| `member.read` | 查看租户成员 |
| `member.invite` | 邀请成员、查询邀请和生成账号建议 |
| `member.update` | 修改成员资料和状态 |
| `member.account.update` | 修改成员登录账号 |
| `member.credential.reset` | 重置成员凭证并签发激活令牌 |
| `member.remove` | 移除成员 |
| `department.read` | 查看部门树、详情和部门成员 |
| `department.create` | 创建部门 |
| `department.update` | 修改、移动和启停部门 |
| `department.delete` | 删除空部门 |
| `department.member.assign` | 调整成员所属部门 |
| `project.create` | 创建项目 |
| `project.read` | 查看参与的项目 |
| `project.update` | 修改参与的非只读项目并执行常规状态流转 |
| `project.delete` | 删除没有业务数据的项目 |
| `project.member.read` | 查看项目成员 |
| `project.member.manage` | 添加、修改、移除项目成员及转移负责人 |
| `project.complete` | 完成项目 |
| `project.reopen` | 重新开启已完成项目 |
| `project.archive` | 归档和恢复项目 |
| `project.manage_all` | 管理当前租户全部项目并绕过项目成员范围 |
| `role.read` | 查看权限和角色 |
| `role.create` | 创建角色 |
| `role.update` | 修改角色及其权限 |
| `role.delete` | 删除角色 |
| `role.assign` | 给成员分配角色 |
| `document.create` | 创建 Managed Document |
| `document.read` | 读取授权范围内文档 |
| `document.update` | 修改授权范围内文档 |
| `document.delete` | 删除授权范围内文档 |
| `document.share` | 管理文档资源 ACL |
| `document.manage_all` | 管理当前租户全部文档的资源范围 |
| `audit.read` | 查询当前租户审计 |

### 9.2 平台权限目录

`SUPER_ADMIN` 当前拥有全部平台权限：

```text
platform.tenant.read
platform.tenant.create
platform.tenant.update
platform.tenant.suspend
platform.tenant.restore
platform.tenant.admin.read
platform.tenant.admin.assign
platform.tenant.admin.remove
platform.audit.read
```

### 9.3 状态枚举

| 枚举 | 值与含义 |
| --- | --- |
| `TenantStatus` | `PENDING_ACTIVATION` 待首位管理员激活；`ACTIVE` 正常；`SUSPENDED` 平台停用 |
| `PlatformRole` | 当前只有 `SUPER_ADMIN`，拥有全部平台权限 |
| `PlatformAdministratorStatus` | `ACTIVE` 可登录；`DISABLED` 禁用 |
| `TenantInvitationStatus` | `PENDING` 待使用；`ACCEPTED` 已接受；`REVOKED` 已撤销；`EXPIRED` 已过期 |
| `UserStatus` | `ACTIVE` 正常；`LOCKED` 锁定；`DISABLED` 禁用 |
| `MembershipStatus` | `PENDING_ACTIVATION` 待设置密码；`ACTIVE` 正常；`DISABLED` 禁用 |
| `DepartmentStatus` | `ACTIVE` 启用；`DISABLED` 停用 |
| `ProjectStatus` | `PLANNING` 规划；`ACTIVE` 进行中；`PAUSED` 暂停；`COMPLETED` 完成；`CANCELLED` 取消；`ARCHIVED` 归档 |
| `ProjectMemberRole` | `OWNER` 唯一负责人；`MANAGER` 项目经理；`MEMBER` 普通项目成员 |
| `AuditOutcome` | `SUCCESS` 成功；`FAILURE` 失败 |
| `ResourceType` | 当前只有 `DOCUMENT` |
| `AclSubjectType` | `MEMBERSHIP` 成员；`ROLE` 角色 |
| `DocumentVisibility` | `PRIVATE` 私有；`TENANT` 租户内可读 |
| `VisibilityScope` | `PRIVATE`、`DEPARTMENT`、`PROJECT`、`TENANT`、`CUSTOM` |
| `DataScope` | `SELF`、`DEPARTMENT`、`DEPARTMENT_TREE`、`PROJECT`、`CUSTOM`、`TENANT` |
| `TaskStatus` | `TODO`、`IN_PROGRESS`、`BLOCKED`、`DONE`、`CANCELLED` |
| `TaskPriority` | `LOW`、`MEDIUM`、`HIGH`、`URGENT` |
| `DraftStatus` | `DRAFT`、`PENDING_CONFIRMATION`、`CONFIRMED`、`REJECTED`、`EXPIRED`、`EXECUTED`、`FAILED` |

## 10. 平台整体流转

### 10.1 平台初始化与租户开通

```mermaid
flowchart TD
  Seed[执行 Prisma seed] --> PA[创建平台超级管理员 superadmin]
  Seed --> LT[创建本地租户 cees 与管理员 admin]
  PA --> PL[平台管理员登录]
  PL --> CT[创建正式租户]
  CT --> TPA[租户状态 PENDING_ACTIVATION]
  CT --> RI[创建 tenant_admin 角色与权限]
  CT --> INV[生成首位管理员邀请和一次性令牌]
  INV --> ACT[首位管理员调用 auth/activate]
  ACT --> MEM[创建 ACTIVE TenantMembership]
  MEM --> ROLE[分配 tenant_admin]
  ROLE --> TA[租户状态切换为 ACTIVE]
```

### 10.2 租户成员生命周期

```mermaid
flowchart LR
  Admin[租户管理员] --> Suggest[生成账号建议]
  Suggest --> Invite[创建邀请]
  Invite --> Pending[邀请 PENDING]
  Pending --> Activate[成员设置密码并激活]
  Activate --> Active[成员 ACTIVE]
  Active --> Login[租户登录]
  Login --> Session[AuthSession]
  Active --> Update[修改资料、账号或角色]
  Active --> Reset[重置凭证]
  Reset --> PendingActivation[成员 PENDING_ACTIVATION]
  PendingActivation --> Activate
  Active --> Disable[禁用或移除]
  Disable --> Revoke[撤销成员全部 Session]
```

### 10.3 本人修改密码

```mermaid
flowchart LR
  User[已登录成员或平台管理员] --> Token[校验当前认证域 Access Token 与 Session]
  Token --> Identity[加载 ACTIVE 身份和当前密码 Hash]
  Identity --> Current{当前密码正确?}
  Current -- 否 --> Failure[记录失败审计并返回 401]
  Current -- 是 --> Same{新密码与当前密码相同?}
  Same -- 是 --> Reject[返回 400]
  Same -- 否 --> Hash[Argon2 生成新密码 Hash]
  Hash --> Update[更新密码并清除失败次数和锁定]
  Update --> Revoke[撤销当前 Session 之外的其他 Session]
  Revoke --> Audit[记录成功审计]
  Audit --> Keep[当前 Session 保持有效]
```

租户成员成功时写入 `AUTH_PASSWORD_CHANGED`，当前密码错误时写入 `AUTH_PASSWORD_CHANGE_FAILED`；平台管理员对应写入 `PLATFORM_PASSWORD_CHANGED` 和 `PLATFORM_PASSWORD_CHANGE_FAILED`。审计元数据不保存明文密码或密码 Hash，成功事件只记录当前 Session 和被撤销的其他 Session 数量。

### 10.4 部门与成员归属

```mermaid
flowchart LR
  Admin[持有部门权限的成员] --> Create[创建根部门或子部门]
  Create --> Tree[形成最多 10 级部门树]
  Tree --> Assign[为成员分配 ACTIVE 部门]
  Assign --> Move[成员调部门或取消归属]
  Tree --> Update[修改、移动或停用部门]
  Update --> Check{无子部门且无成员?}
  Check -- 是 --> Delete[软删除部门]
  Check -- 否 --> Reject[409 拒绝删除]
```

所有部门查询和写入都使用 JWT 中的当前 `tenantId`；平台管理员不能跨过租户权限直接维护部门。部门创建、修改、移动、删除和成员调部门分别写入 `DEPARTMENT_CREATED`、`DEPARTMENT_UPDATED`、`DEPARTMENT_MOVED`、`DEPARTMENT_DELETED`、`MEMBER_DEPARTMENT_CHANGED` 审计动作。

### 10.5 请求授权链路

```mermaid
flowchart LR
  Request[客户端请求] --> JWT[校验 Access Token]
  JWT --> Session[校验数据库 Session 未撤销]
  Session --> Tenant[加载租户和 Membership]
  Tenant --> RBAC[实时查询角色与权限]
  RBAC --> Op{有操作权限?}
  Op -- 否 --> Deny[403]
  Op -- 是 --> Scope{需要资源范围?}
  Scope -- 否 --> Execute[执行业务]
  Scope -- 是 --> Resource[所有权、可见性、ACL 或 manage_all]
  Resource -- 否 --> Deny
  Resource -- 是 --> Execute
  Execute --> Audit[写入审计]
```

### 10.6 租户停用与恢复

```text
PENDING_ACTIVATION --首位管理员激活--> ACTIVE
ACTIVE ------------平台停用--------> SUSPENDED
SUSPENDED ---------存在有效管理员---> ACTIVE
```

- 停用租户会撤销该租户全部未撤销 `auth_sessions`；
- 恢复租户不会恢复旧 Session，所有成员必须重新登录；
- 没有有效租户管理员时不允许恢复；
- 平台操作写入 `platform_audit_logs`，租户操作写入 `audit_logs`。

## 11. 数据库通用约定

### 11.1 通用字段

以下字段在多张表中重复出现，语义保持一致；具体某张表是否包含该字段，以后续表级清单为准。

| 字段 | 含义 |
| --- | --- |
| `id` | UUID 主键；客户端应作为不透明 ID 使用 |
| `tenant_id` | 数据所属租户 UUID，是租户隔离的核心字段 |
| `user_id` | 全局 User UUID；不代表某一租户内的 Membership |
| `created_at` | 数据创建时间 |
| `updated_at` | 最近更新时间，通常由 Prisma 自动维护 |
| `created_by` | 创建者 User UUID；后台任务创建时可以为空 |
| `updated_by` | 最近修改者 User UUID |
| `deleted_at` | 软删除时间；非空表示正常业务查询应排除 |
| `version` | 乐观锁版本，修改成功后递增 |

密码、Refresh Token 和邀请令牌都只保存 Hash，不保存可反查的明文。数据库中的 `password_hash`、`refresh_token_hash`、`token_hash` 不能作为登录输入直接使用。

### 11.2 Prisma 迁移表

#### `_prisma_migrations`

Prisma 自动维护的迁移历史表，记录迁移名称、校验值、开始/完成时间和失败信息。不要通过 Navicat 手工修改。业务表结构只能通过 `apps/api/prisma/migrations` 演进。

当前空库按以下顺序执行：

```text
0001_init
0002_platform_tenant_administration
0003_organization_departments_and_database_comments
0004_redis_cos_upload_foundation
0005_project_management
```

- 使用 `pnpm --filter @cees/api exec prisma migrate deploy` 执行已提交迁移；
- `0003` 新增部门层级字段、部门权限、同级名称唯一索引和父部门外键；
- `0003` 已为当前 39 张业务表和 422 个业务字段补齐 PostgreSQL 注释；
- `0004` 新增上传会话表和正式文件的 COS 定位字段，并为新增表、枚举和字段写入中文注释；
- `0005` 将项目成员改为关联 TenantMembership，新增项目状态历史、负责人、编码和完成信息；
- 当前共 41 张业务表和 470 个业务字段；
- 后续新建表或字段时，必须在同一迁移中添加 `COMMENT ON TABLE` 和 `COMMENT ON COLUMN`；
- Prisma Schema、迁移 SQL 和本数据字典必须保持一致。

## 12. 身份、租户和认证表

### 12.1 `tenants`

租户主表，是租户级业务数据的逻辑边界。

| 字段 | 含义 |
| --- | --- |
| `id` | 租户 UUID |
| `code` | 全局唯一租户编码，用于租户登录 |
| `name` | 租户展示名称 |
| `status` | `PENDING_ACTIVATION/ACTIVE/SUSPENDED` |
| `created_at/updated_at` | 创建和更新时间 |
| `deleted_at` | 软删除时间 |
| `version` | 租户乐观锁版本 |

### 12.2 `users`

全局人员身份表。一个 User 可以通过多个 Membership 加入多个租户，也可以关联平台管理员身份。

| 字段 | 含义 |
| --- | --- |
| `id` | 全局人员 UUID |
| `email` | 兼容阶段保留的可选邮箱，当前账号登录不依赖它 |
| `normalized_email` | 规范化邮箱，兼容字段，全局唯一且可空 |
| `password_hash` | 兼容阶段保留的可选密码 Hash，当前租户认证不依赖它 |
| `display_name` | 全局展示名称 |
| `status` | 全局人员状态 `ACTIVE/LOCKED/DISABLED` |
| `failed_login_count` | 兼容的全局失败次数 |
| `locked_until` | 兼容的全局锁定截止时间 |
| `last_login_at` | 兼容的全局最后登录时间 |
| `created_at/updated_at` | 创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 UUID |
| `deleted_at` | 软删除时间 |
| `version` | 人员版本 |

### 12.3 `tenant_memberships`

用户加入某一租户后的真实成员身份，也是租户账号和租户凭证的保存位置。

| 字段 | 含义 |
| --- | --- |
| `id` | Membership UUID；JWT 中的 `mid` 使用该值 |
| `tenant_id` | 所属租户 |
| `user_id` | 对应全局 User |
| `department_id` | 所属部门，可空 |
| `display_name` | 租户内展示名称，可覆盖 User 展示名 |
| `account` | 用户输入和展示的租户账号 |
| `normalized_account` | 小写规范化账号；与 `tenant_id` 组合唯一 |
| `password_hash` | 租户账号密码 Hash；待激活时可空 |
| `status` | `PENDING_ACTIVATION/ACTIVE/DISABLED` |
| `failed_login_count` | 该租户账号连续失败次数 |
| `locked_until` | 该租户账号锁定截止时间 |
| `last_login_at` | 该租户账号最后成功登录时间 |
| `joined_at` | 加入租户时间 |
| `created_at/updated_at` | 创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 UUID |
| `deleted_at` | 被移出租户的软删除时间 |
| `version` | 成员乐观锁版本 |

### 12.4 `auth_sessions`

租户登录会话表，用于 Refresh Token 轮换和即时撤销 Access Token 对应会话。

| 字段 | 含义 |
| --- | --- |
| `id` | Session UUID；JWT 中的 `sid` 使用该值 |
| `tenant_id` | 会话租户 |
| `user_id` | 会话全局用户 |
| `membership_id` | 会话租户成员 |
| `refresh_token_hash` | Refresh Token Hash，全局唯一 |
| `device_name` | 登录设备名称 |
| `ip_address` | 登录或刷新时 IP |
| `user_agent` | 客户端 User-Agent |
| `expires_at` | Refresh Session 过期时间 |
| `last_used_at` | 最近刷新使用时间 |
| `revoked_at` | 撤销时间；非空后 Access Token 也不可继续使用 |
| `created_at/updated_at` | 创建和更新时间 |

### 12.5 `platform_administrators`

平台管理员账号表。查询“平台管理员账号”时重点查看本表，并关联 `users` 获取展示名称。

| 字段 | 含义 |
| --- | --- |
| `id` | 平台管理员 UUID |
| `user_id` | 一对一关联的全局 User UUID |
| `account` | 平台账号原始值 |
| `normalized_account` | 小写规范化账号，全局唯一 |
| `password_hash` | 平台密码 Hash |
| `role` | 当前为 `SUPER_ADMIN` |
| `status` | `ACTIVE` 或 `DISABLED` |
| `failed_login_count` | 平台登录连续失败次数 |
| `locked_until` | 平台账号锁定截止时间 |
| `last_login_at` | 平台最后成功登录时间 |
| `created_at/updated_at` | 创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 UUID |
| `deleted_at` | 软删除时间 |
| `version` | 平台管理员版本 |

### 12.6 `platform_auth_sessions`

平台管理员独立 Session 表，不与租户 `auth_sessions` 混用。

| 字段 | 含义 |
| --- | --- |
| `id` | 平台 Session UUID |
| `platform_administrator_id` | 平台管理员 UUID |
| `user_id` | 对应全局 User UUID |
| `refresh_token_hash` | 平台 Refresh Token Hash |
| `device_name/ip_address/user_agent` | 登录客户端信息 |
| `expires_at` | Session 过期时间 |
| `last_used_at` | 最近刷新时间 |
| `revoked_at` | 撤销时间 |
| `created_at/updated_at` | 创建和更新时间 |

### 12.7 `departments`

租户组织部门树，已经提供公开管理 API。`parent_id` 自关联同一张表，部门写操作使用乐观锁和软删除。

| 字段 | 含义 |
| --- | --- |
| `id` | 部门 UUID |
| `tenant_id` | 所属租户 |
| `parent_id` | 父部门 UUID；为空表示根部门 |
| `name` | 部门名称 |
| `normalized_name` | 规范化部门名称，用于未删除同级部门唯一性校验 |
| `description` | 部门说明，可空 |
| `sort_order` | 同级排序值，数值越小越靠前 |
| `status` | `ACTIVE/DISABLED`；只能向启用部门分配成员 |
| `created_at/updated_at` | 创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 |
| `deleted_at` | 软删除时间 |
| `version` | 部门版本 |

部门数据约束：

- 最大层级为 10 级，创建和移动时禁止形成父子循环；
- 未删除根部门名称在租户内唯一；未删除子部门名称在同一父部门下唯一；
- `deleted_at` 非空后不再参与名称唯一约束，原名称可以重新使用；
- 存在未删除子部门或成员时不能删除部门；
- `status = DISABLED` 的部门不能接收新的成员分配；
- 修改、移动和删除时必须提交当前 `version`。

## 13. 邀请和 RBAC 表

### 13.1 `tenant_invitations`

租户成员首次激活、首位管理员激活和凭证重置共用的一次性邀请记录。

| 字段 | 含义 |
| --- | --- |
| `id` | 邀请 UUID |
| `tenant_id` | 目标租户 |
| `account` | 为成员预留的账号 |
| `normalized_account` | 小写规范化账号，用于冲突检查 |
| `display_name` | 被邀请人的展示名称 |
| `target_membership_id` | 凭证重置时指向已有 Membership；新成员邀请为空 |
| `token_hash` | 一次性邀请令牌 Hash，全局唯一 |
| `status` | `PENDING/ACCEPTED/REVOKED/EXPIRED` |
| `is_initial_administrator` | 是否为租户首位管理员邀请 |
| `expires_at` | 邀请过期时间 |
| `accepted_at` | 接受时间 |
| `accepted_by_user_id` | 最终接受邀请的 User UUID |
| `invited_by_user_id` | 发起邀请的 User UUID；平台创建租户时记录平台操作者对应 User |
| `revoked_at` | 撤销时间 |
| `created_at/updated_at` | 创建和更新时间 |

### 13.2 `tenant_invitation_roles`

邀请与待分配角色的多对多关系。

| 字段 | 含义 |
| --- | --- |
| `id` | 关系 UUID |
| `invitation_id` | 邀请 UUID |
| `role_id` | 激活后要分配的角色 UUID |
| `created_at` | 创建时间 |

### 13.3 `permissions`

平台预置的租户权限目录。

| 字段 | 含义 |
| --- | --- |
| `id` | 权限 UUID |
| `code` | 全局唯一权限编码，如 `member.read` |
| `name` | 权限中文名称 |
| `created_at/updated_at` | 创建和更新时间 |

### 13.4 `roles`

租户角色表，包含系统角色和租户自定义角色。

| 字段 | 含义 |
| --- | --- |
| `id` | 角色 UUID |
| `tenant_id` | 所属租户 |
| `code` | 租户内唯一稳定编码 |
| `name` | 展示名称 |
| `description` | 角色说明 |
| `is_system` | 是否系统角色；`tenant_admin` 为 `true` |
| `data_scope` | 数据范围 `DataScope` |
| `created_at/updated_at` | 创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 |
| `deleted_at` | 软删除时间 |
| `version` | 角色乐观锁版本 |

### 13.5 `membership_roles`

租户成员和角色的多对多关系，是判断“某成员是否为租户管理员”的关键表。

| 字段 | 含义 |
| --- | --- |
| `id` | 关系 UUID |
| `tenant_id` | 冗余租户边界，防止跨租户关联 |
| `membership_id` | 租户成员 UUID |
| `role_id` | 角色 UUID |
| `created_at` | 分配时间 |

### 13.6 `role_permissions`

租户角色和权限的多对多关系。

| 字段 | 含义 |
| --- | --- |
| `id` | 关系 UUID |
| `tenant_id` | 所属租户 |
| `role_id` | 角色 UUID |
| `permission_id` | 权限 UUID |
| `created_at` | 分配时间 |

## 14. 资源与受控文档表

### 14.1 `resources`

统一资源授权根。当前资源类型只有 `DOCUMENT`。

| 字段 | 含义 |
| --- | --- |
| `id` | Resource UUID；与对应 `managed_documents.id` 相同 |
| `tenant_id` | 所属租户 |
| `type` | 资源类型，当前为 `DOCUMENT` |
| `owner_membership_id` | 资源所有者 Membership UUID |
| `created_at/updated_at` | 创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 |
| `deleted_at` | 软删除时间 |
| `version` | 资源版本 |

### 14.2 `managed_documents`

已经开放公开 API 的受控文档表，不要与知识库的 `documents` 表混淆。

| 字段 | 含义 |
| --- | --- |
| `id` | 文档 UUID，同时引用 `resources.id` |
| `tenant_id` | 所属租户 |
| `title` | 文档标题 |
| `content` | 文档正文文本 |
| `visibility` | `PRIVATE` 或 `TENANT` |
| `created_at/updated_at` | 创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 |
| `deleted_at` | 软删除时间 |
| `version` | 文档乐观锁版本 |

### 14.3 `resource_acls`

资源级授权表。ACL 只能扩展资源范围，不能绕过角色的 RBAC 操作权限。

| 字段 | 含义 |
| --- | --- |
| `id` | ACL UUID |
| `tenant_id` | 所属租户 |
| `resource_id` | 被授权 Resource UUID |
| `subject_type` | `MEMBERSHIP` 或 `ROLE` |
| `subject_id` | 对应成员或角色 UUID |
| `permission_codes` | PostgreSQL 字符串数组，保存文档权限编码 |
| `expires_at` | 授权过期时间；为空表示长期有效 |
| `created_at/updated_at` | 创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 |
| `deleted_at` | 随资源软删除时使用；正常撤销 ACL 为硬删除 |
| `version` | ACL 乐观锁版本 |

## 15. 项目、任务与文件表

项目和项目成员已经提供公开 API；任务、评论、附件和动态当前仍只有数据库结构。项目完成校验会读取任务状态。

### 15.1 `projects`

项目主表。

| 字段 | 含义 |
| --- | --- |
| `id` | 项目 UUID |
| `tenant_id` | 所属租户 |
| `code` | 租户内项目业务编码 |
| `normalized_code` | 小写规范化编码，与租户组成唯一约束 |
| `department_id` | 所属部门 UUID，可空 |
| `owner_membership_id` | 唯一当前负责人 Membership UUID；旧数据兼容时可空 |
| `name` | 项目名称 |
| `description` | 项目说明 |
| `status` | `PLANNING/ACTIVE/PAUSED/COMPLETED/CANCELLED/ARCHIVED`，默认 `PLANNING` |
| `starts_at/ends_at` | 项目开始和计划结束时间 |
| `completed_at` | 最近一次完成时间 |
| `completed_by_membership_id` | 最近一次完成人 Membership UUID |
| `completion_summary` | 最近一次完成总结 |
| `created_at/updated_at` | 创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 |
| `deleted_at` | 软删除时间 |
| `version` | 项目版本 |

### 15.2 `project_members`

项目和租户成员的关系。项目角色不会替代租户 RBAC 权限。

| 字段 | 含义 |
| --- | --- |
| `id` | 关系 UUID |
| `tenant_id` | 所属租户 |
| `project_id` | 项目 UUID |
| `membership_id` | 当前租户 Membership UUID，不使用全局 User UUID |
| `role` | `OWNER/MANAGER/MEMBER`，默认 `MEMBER` |
| `joined_at` | 最近一次加入项目时间 |
| `created_at/updated_at` | 关系创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 User UUID |
| `deleted_at` | 移出项目时间；重新加入会恢复原记录 |
| `version` | 成员关系乐观锁版本 |

### 15.3 `project_status_history`

项目状态变化历史，不随项目完成或归档删除。

| 字段 | 含义 |
| --- | --- |
| `id` | 状态历史 UUID |
| `tenant_id` | 所属租户 |
| `project_id` | 项目 UUID |
| `from_status/to_status` | 变更前后项目状态 |
| `reason` | 重开、取消原因或完成总结 |
| `changed_by_membership_id` | 执行状态变化的 Membership UUID |
| `created_at` | 状态变化时间 |

### 15.4 `tasks`

任务主表，支持项目任务、父子任务、优先级、截止时间和通用业务关联。

| 字段 | 含义 |
| --- | --- |
| `id` | 任务 UUID |
| `tenant_id` | 所属租户 |
| `project_id` | 所属项目 UUID，可空 |
| `parent_id` | 父任务 UUID，可空 |
| `title` | 任务标题 |
| `description` | 任务说明 |
| `status` | `TODO/IN_PROGRESS/BLOCKED/DONE/CANCELLED` |
| `priority` | `LOW/MEDIUM/HIGH/URGENT` |
| `due_date` | 截止时间 |
| `relation_type` | 外部业务关联类型 |
| `relation_id` | 外部业务关联资源 UUID |
| `created_at/updated_at` | 创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 |
| `deleted_at` | 软删除时间 |
| `version` | 任务版本 |

### 15.5 `task_assignees`

任务和执行人的多对多关系。

| 字段 | 含义 |
| --- | --- |
| `id` | 分配 UUID |
| `tenant_id` | 所属租户 |
| `task_id` | 任务 UUID |
| `user_id` | 执行人 User UUID |
| `assignee_type` | 执行人类型字符串，默认 `OWNER` |
| `created_at` | 分配时间 |

### 15.6 `task_comments`

任务评论表。

| 字段 | 含义 |
| --- | --- |
| `id` | 评论 UUID |
| `tenant_id` | 所属租户 |
| `task_id` | 任务 UUID |
| `content` | 评论内容 |
| `created_at/updated_at` | 创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 |
| `deleted_at` | 软删除时间 |
| `version` | 评论版本 |

### 15.7 `task_attachments`

任务和文件对象的关联表。

| 字段 | 含义 |
| --- | --- |
| `id` | 附件关系 UUID |
| `tenant_id` | 所属租户 |
| `task_id` | 任务 UUID |
| `file_object_id` | 文件对象 UUID |
| `created_at/updated_at` | 创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 |
| `deleted_at` | 软删除时间 |
| `version` | 附件关系版本 |

### 15.8 `task_activities`

任务领域活动流水，与全局安全审计的 `audit_logs` 用途不同。

| 字段 | 含义 |
| --- | --- |
| `id` | 活动 UUID |
| `tenant_id` | 所属租户 |
| `task_id` | 任务 UUID |
| `action` | 任务动作编码 |
| `metadata` | 动作扩展 JSON |
| `created_at` | 发生时间 |
| `created_by` | 操作者 User UUID |

### 15.9 `file_objects`

正式文件元数据表。二进制内容不进入 PostgreSQL，存放于私有 COS；只有上传会话通过 COS HEAD 校验后才创建记录。

| 字段 | 含义 |
| --- | --- |
| `id` | 文件对象 UUID |
| `tenant_id` | 所属租户 |
| `original_name` | 上传时的原始文件名，仅作为元数据保存 |
| `purpose` | 文件用途，当前仅支持 `ATTACHMENT` |
| `storage_provider` | 对象存储提供商，当前为 `TENCENT_COS` |
| `bucket` | 对象所在的 COS Bucket |
| `region` | 对象所在的 COS 地域 |
| `object_key` | COS 对象键，不是公开下载 URL |
| `mime_type` | MIME 类型 |
| `size_bytes` | 文件字节数 |
| `checksum` | 文件校验值，可空 |
| `etag` | COS 返回的对象 ETag，可空 |
| `created_at/updated_at` | 创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 |
| `deleted_at` | 软删除时间 |
| `version` | 文件元数据版本 |

### 15.10 `upload_sessions`

客户端直传 COS 前由 API 创建的短期上传会话。客户端不能指定租户、Bucket 或对象键。

| 字段 | 含义 |
| --- | --- |
| `id` | 上传会话 UUID |
| `tenant_id` | 上传会话所属租户 |
| `file_id` | 预先生成的正式文件 UUID |
| `created_by` | 创建会话的 User UUID |
| `created_by_membership_id` | 创建会话的租户成员身份 UUID |
| `idempotency_key` | 同一成员重试创建请求时复用的幂等键 |
| `request_fingerprint` | 规范化上传请求的 SHA-256 指纹 |
| `purpose` | 文件用途，当前仅支持 `ATTACHMENT` |
| `original_name` | 客户端提供的原始文件名 |
| `mime_type` | 声明并在完成时校验的 Content-Type |
| `expected_size_bytes` | 声明并在完成时校验的预期字节数 |
| `storage_provider` | 对象存储提供商标识 |
| `bucket` | 本次上传使用的 COS Bucket |
| `region` | 本次上传使用的 COS 地域 |
| `object_key` | 服务端生成的 COS 对象键 |
| `status` | `PENDING`、`COMPLETED`、`EXPIRED` 或 `FAILED` |
| `expires_at` | 上传会话失效时间 |
| `completed_at` | 对象校验通过并登记正式文件的时间，可空 |
| `failure_code` | 失败或过期时的稳定错误代码，可空 |
| `created_at/updated_at` | 创建和更新时间 |

## 16. 知识库与检索表

### 16.1 `knowledge_bases`

知识库主表，目前没有公开管理 API。

| 字段 | 含义 |
| --- | --- |
| `id` | 知识库 UUID |
| `tenant_id` | 所属租户 |
| `name` | 知识库名称 |
| `description` | 知识库说明 |
| `created_at/updated_at` | 创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 |
| `deleted_at` | 软删除时间 |
| `version` | 知识库版本 |

### 16.2 `knowledge_base_members`

知识库与用户的授权关系。

| 字段 | 含义 |
| --- | --- |
| `id` | 关系 UUID |
| `tenant_id` | 所属租户 |
| `knowledge_base_id` | 知识库 UUID |
| `user_id` | User UUID |
| `permission` | 知识库权限字符串，尚未形成公开枚举契约 |
| `created_at` | 创建时间 |

### 16.3 `documents`

知识库文档表，对应 Prisma 模型 `KnowledgeDocument`。它与已经开放 API 的 `managed_documents` 是两个不同概念。

| 字段 | 含义 |
| --- | --- |
| `id` | 知识文档 UUID |
| `tenant_id` | 所属租户 |
| `knowledge_base_id` | 所属知识库 UUID |
| `file_object_id` | 原始文件对象 UUID |
| `name` | 文档名称 |
| `status` | 处理状态字符串，默认 `PENDING` |
| `department_id` | 可见部门 UUID，可空 |
| `project_id` | 可见项目 UUID，可空 |
| `created_at/updated_at` | 创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 |
| `deleted_at` | 软删除时间 |
| `version` | 知识文档版本 |

### 16.4 `document_versions`

知识文档文件版本表。

| 字段 | 含义 |
| --- | --- |
| `id` | 版本记录 UUID |
| `tenant_id` | 所属租户 |
| `document_id` | 知识文档 UUID |
| `file_object_id` | 该版本对应文件对象 UUID |
| `version_number` | 文档内部版本号 |
| `created_at` | 版本创建时间 |
| `created_by` | 创建者 User UUID |

### 16.5 `document_chunks`

知识文档切片和向量检索数据表。

| 字段 | 含义 |
| --- | --- |
| `id` | Chunk UUID |
| `tenant_id` | 所属租户 |
| `knowledge_base_id` | 所属知识库 UUID |
| `document_id` | 来源知识文档 UUID |
| `department_id` | 部门过滤维度，可空 |
| `project_id` | 项目过滤维度，可空 |
| `visibility_scope` | `PRIVATE/DEPARTMENT/PROJECT/TENANT/CUSTOM` |
| `content` | 切片文本 |
| `embedding` | pgvector 向量字段，Prisma 使用 `Unsupported(vector)` 映射 |
| `metadata` | 切片扩展 JSON |
| `chunk_index` | 在原文档中的切片顺序 |
| `created_at/updated_at` | 创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 |
| `deleted_at` | 软删除时间 |
| `version` | Chunk 版本 |

### 16.6 `knowledge_query_logs`

知识检索问答日志。

| 字段 | 含义 |
| --- | --- |
| `id` | 查询日志 UUID |
| `tenant_id` | 所属租户 |
| `user_id` | 发起查询的 User UUID |
| `query` | 用户问题 |
| `answer` | 最终回答，可空 |
| `citations` | 引用信息 JSON，可空 |
| `request_id` | 请求追踪 ID |
| `created_at` | 查询时间 |

## 17. 会议与通知表

### 17.1 `meetings`

会议主表，目前没有公开 API。

| 字段 | 含义 |
| --- | --- |
| `id` | 会议 UUID |
| `tenant_id` | 所属租户 |
| `title` | 会议标题 |
| `starts_at` | 开始时间 |
| `duration_minutes` | 预计时长，单位分钟 |
| `department_id` | 所属部门 UUID，可空 |
| `agenda` | 会议议程 JSON |
| `created_at/updated_at` | 创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 |
| `deleted_at` | 软删除时间 |
| `version` | 会议版本 |

### 17.2 `meeting_participants`

会议参会人关系。

| 字段 | 含义 |
| --- | --- |
| `id` | 关系 UUID |
| `tenant_id` | 所属租户 |
| `meeting_id` | 会议 UUID |
| `user_id` | 参会人 User UUID |
| `status` | 参会状态字符串，默认 `INVITED` |
| `created_at` | 邀请或加入时间 |

### 17.3 `meeting_minutes`

会议纪要表。

| 字段 | 含义 |
| --- | --- |
| `id` | 纪要 UUID |
| `tenant_id` | 所属租户 |
| `meeting_id` | 会议 UUID |
| `content` | 结构化纪要 JSON |
| `status` | 纪要状态字符串，默认 `DRAFT` |
| `created_at/updated_at` | 创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 |
| `deleted_at` | 软删除时间 |
| `version` | 纪要版本 |

### 17.4 `notifications`

通知内容主表。

| 字段 | 含义 |
| --- | --- |
| `id` | 通知 UUID |
| `tenant_id` | 所属租户 |
| `title` | 通知标题 |
| `content` | 通知正文 |
| `channel` | 通知渠道字符串，默认 `IN_APP` |
| `relation_type` | 关联业务类型 |
| `relation_id` | 关联业务资源 UUID |
| `created_at/updated_at` | 创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 |
| `deleted_at` | 软删除时间 |
| `version` | 通知版本 |

### 17.5 `notification_recipients`

通知和接收用户的关系及阅读状态。

| 字段 | 含义 |
| --- | --- |
| `id` | 接收关系 UUID |
| `tenant_id` | 所属租户 |
| `notification_id` | 通知 UUID |
| `user_id` | 接收人 User UUID |
| `read_at` | 阅读时间；为空表示未读 |
| `created_at` | 投递时间 |

## 18. AI 与审计表

### 18.1 `ai_action_drafts`

AI 生成的待确认动作草稿。它不是正式业务数据，只有经过 NestJS 权限校验和确认流程后才能执行正式写入。

| 字段 | 含义 |
| --- | --- |
| `id` | 草稿 UUID |
| `tenant_id` | 所属租户 |
| `user_id` | 发起 AI 请求的 User UUID |
| `action_type` | 建议执行的动作类型 |
| `payload` | 草稿结构化内容 JSON |
| `status` | `DraftStatus` |
| `expires_at` | 草稿失效时间 |
| `executed_resource_type` | 执行后生成的正式资源类型 |
| `executed_resource_id` | 执行后生成的正式资源 UUID |
| `created_at/updated_at` | 创建和更新时间 |
| `created_by/updated_by` | 创建和修改者 |
| `deleted_at` | 软删除时间 |
| `version` | 草稿版本 |

### 18.2 `ai_invocation_logs`

NestJS 编排 AI 调用时记录的模型调用指标。

| 字段 | 含义 |
| --- | --- |
| `id` | 调用日志 UUID |
| `tenant_id` | 所属租户 |
| `user_id` | 发起调用的 User UUID |
| `request_id` | 业务请求追踪 ID |
| `trace_id` | 跨服务 Trace ID，可空 |
| `model` | 实际模型名称 |
| `latency_ms` | 调用耗时，毫秒 |
| `input_tokens/output_tokens` | 输入和输出 Token 数，可空 |
| `operation` | AI 操作类型 |
| `metadata` | 扩展指标和路由信息 JSON |
| `created_at` | 调用时间 |

### 18.3 `audit_logs`

租户业务审计表。所有查询都必须按 `tenant_id` 隔离。

| 字段 | 含义 |
| --- | --- |
| `id` | 审计 UUID |
| `tenant_id` | 所属租户 |
| `actor_user_id` | 操作者全局 User UUID |
| `actor_membership_id` | 操作者 Membership UUID |
| `action` | 操作动作编码 |
| `outcome` | `SUCCESS` 或 `FAILURE` |
| `resource_type` | 操作资源类型 |
| `resource_id` | 操作资源 UUID，可空 |
| `request_id` | HTTP 请求追踪 ID |
| `ip_address` | 客户端 IP |
| `user_agent` | 客户端 User-Agent |
| `metadata` | 操作前后值、原因等扩展 JSON |
| `created_at` | 审计发生时间 |

### 18.4 `platform_audit_logs`

平台管理审计表，与租户审计分开保存。

| 字段 | 含义 |
| --- | --- |
| `id` | 平台审计 UUID |
| `actor_user_id` | 平台操作者对应 User UUID |
| `actor_platform_administrator_id` | 平台管理员 UUID |
| `action` | 平台动作编码 |
| `outcome` | `SUCCESS` 或 `FAILURE` |
| `resource_type` | 平台操作资源类型 |
| `resource_id` | 租户、管理员等资源 UUID |
| `request_id` | HTTP 请求追踪 ID |
| `ip_address` | 客户端 IP |
| `user_agent` | 客户端 User-Agent |
| `metadata` | 停用原因、前后状态等扩展 JSON |
| `created_at` | 审计发生时间 |

## 19. Navicat 常用只读查询

### 19.1 查询平台管理员

```sql
SELECT
  pa.id,
  pa.account,
  pa.role,
  pa.status,
  u.display_name,
  pa.last_login_at,
  pa.created_at
FROM platform_administrators pa
JOIN users u ON u.id = pa.user_id
WHERE pa.deleted_at IS NULL;
```

### 19.2 查询租户管理员

```sql
SELECT
  t.code AS tenant_code,
  t.name AS tenant_name,
  tm.id AS membership_id,
  tm.account,
  tm.display_name,
  tm.status,
  r.code AS role_code
FROM tenant_memberships tm
JOIN tenants t ON t.id = tm.tenant_id
JOIN membership_roles mr ON mr.membership_id = tm.id AND mr.tenant_id = tm.tenant_id
JOIN roles r ON r.id = mr.role_id AND r.tenant_id = tm.tenant_id
WHERE r.code = 'tenant_admin'
  AND tm.deleted_at IS NULL
  AND r.deleted_at IS NULL;
```

### 19.3 查询角色权限

```sql
SELECT
  t.code AS tenant_code,
  r.code AS role_code,
  r.name AS role_name,
  p.code AS permission_code,
  p.name AS permission_name
FROM roles r
JOIN tenants t ON t.id = r.tenant_id
JOIN role_permissions rp ON rp.role_id = r.id AND rp.tenant_id = r.tenant_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.deleted_at IS NULL
ORDER BY t.code, r.code, p.code;
```

### 19.4 查询未撤销会话

```sql
SELECT
  t.code AS tenant_code,
  tm.account,
  s.device_name,
  s.ip_address,
  s.expires_at,
  s.last_used_at,
  s.created_at
FROM auth_sessions s
JOIN tenants t ON t.id = s.tenant_id
JOIN tenant_memberships tm ON tm.id = s.membership_id
WHERE s.revoked_at IS NULL
ORDER BY s.created_at DESC;
```

### 19.5 查询待激活邀请

```sql
SELECT
  t.code AS tenant_code,
  i.account,
  i.display_name,
  i.is_initial_administrator,
  i.expires_at,
  i.created_at
FROM tenant_invitations i
JOIN tenants t ON t.id = i.tenant_id
WHERE i.status = 'PENDING'
ORDER BY i.created_at DESC;
```

不要在数据库中直接修改角色、成员状态、密码 Hash、Session 或审计数据。正式业务修改应走 NestJS API，以确保权限、乐观锁、会话撤销和审计保持一致。

## 20. Swagger 推荐验证顺序

### 20.1 平台管理员登录

调用 `POST /api/v1/platform/auth/login`：

```json
{
  "account": "superadmin",
  "password": "change_me",
  "deviceName": "Local Swagger"
}
```

复制响应中的 `data.accessToken`，在 Swagger 的 `platformBearerAuth` 中填入 Token，然后依次验证：

```text
GET /api/v1/platform/auth/me
GET /api/v1/platform/tenants
GET /api/v1/platform/audit-events
```

### 20.2 租户管理员登录

调用 `POST /api/v1/auth/login`：

```json
{
  "tenantCode": "cees",
  "account": "admin",
  "password": "change_me",
  "deviceName": "Local Swagger"
}
```

复制响应中的 `data.accessToken`，在 Swagger 默认 `bearerAuth` 中填入 Token，然后依次验证：

```text
GET /api/v1/auth/me
GET /api/v1/tenants/current
GET /api/v1/permissions
GET /api/v1/roles
GET /api/v1/tenants/current/members
GET /api/v1/tenants/current/departments
GET /api/v1/audit-events
```

### 20.3 修改当前账号密码

租户成员先使用租户 Access Token 调用：

```http
POST /api/v1/auth/change-password
Authorization: Bearer <tenant-access-token>
```

平台超级管理员使用平台 Access Token 调用：

```http
POST /api/v1/platform/auth/change-password
Authorization: Bearer <platform-access-token>
```

两个接口请求体相同：

```json
{
  "currentPassword": "change_me",
  "newPassword": "change_me_new"
}
```

成功返回 `204 No Content`。验证时建议同时确认：

1. 当前 Access Token 仍可调用对应的 `/auth/me` 或 `/platform/auth/me`；
2. 该身份在其他设备或浏览器中的旧 Session 已被撤销；
3. 退出当前 Session 后，旧密码不能登录，新密码可以登录；
4. 租户域查看 `audit_logs`，平台域查看 `platform_audit_logs`；
5. 当前密码错误返回 `401 AUTH_CURRENT_PASSWORD_INVALID`，新旧密码相同返回 `400 AUTH_NEW_PASSWORD_SAME_AS_CURRENT`。

生产或共享环境不要继续使用示例密码 `change_me`，示例中的新密码也应替换为符合环境安全策略的值。

### 20.4 组织部门管理

先创建根部门：

```json
{
  "name": "总部",
  "description": "企业组织根部门",
  "sortOrder": 0
}
```

再创建子部门：

```json
{
  "name": "研发部",
  "parentId": "根部门 UUID",
  "description": "产品研发部门",
  "sortOrder": 10
}
```

建议按以下顺序验证：

```text
POST   /api/v1/tenants/current/departments
GET    /api/v1/tenants/current/departments
PATCH  /api/v1/tenants/current/departments/{departmentId}
PUT    /api/v1/tenants/current/members/{membershipId}/department
GET    /api/v1/tenants/current/departments/{departmentId}/members
DELETE /api/v1/tenants/current/departments/{departmentId}?version={version}
```

成员调部门需要先通过 `GET /api/v1/tenants/current/members/{membershipId}` 获取最新成员 `version`：

```json
{
  "departmentId": "目标部门 UUID",
  "version": 1
}
```

删除测试应先删除没有成员和子部门的叶子部门；删除仍有成员或子部门的部门会返回 `409 DEPARTMENT_NOT_EMPTY`。

### 20.5 批量导入组织架构和成员

该功能适用于租户首次初始化组织架构，或者一次新增较多部门和人员。Excel 由前端解析，不上传给 API；API 只接收前端转换后的标准 JSON。

建议操作顺序：

1. 租户管理员下载 Excel 模板并填写部门、人员。
2. 前端读取 Excel，检查列名、空行和部门路径格式。
3. 前端生成账号建议以及请求内部使用的 `clientRef`。
4. 管理员在预览页处理账号冲突、选择默认角色，必要时给个别成员单独设置角色。
5. 前端调用 `validate`，展示后端返回的部门创建/复用结果和逐行错误。
6. 管理员确认后调用 `confirm` 正式导入。
7. 前端根据确认响应立即生成成员激活凭证 Excel。

#### 20.5.1 Excel 模板结构

一个 Excel 文件建议包含两个 Sheet，Sheet 名称固定为“部门”和“人员”。模板中不出现数据库 UUID、部门编码、角色编码或 `clientRef` 等技术字段。

**Sheet 1：部门**

| 部门路径 | 排序 | 部门说明 |
| --- | ---: | --- |
| 总部 | 0 | 公司总部 |
| 总部/研发部 | 10 | 产品研发部门 |
| 总部/研发部/后端组 | 10 | 后端研发小组 |
| 总部/研发部/前端组 | 20 | 前端研发小组 |
| 总部/销售部 | 20 | 销售与客户维护 |

部门填写规则：

- `部门路径` 必填，使用 `/` 表示上下级关系。
- `总部/研发部/后端组` 表示“后端组”的父部门是“研发部”，“研发部”的父部门是“总部”。
- 部门名称本身不能包含 `/`，路径不能以 `/` 开头或结尾，也不能包含连续的 `//`。
- 最大支持 10 级部门。
- 完整路径在同一 Excel 中必须唯一。
- 父路径必须存在，例如填写“总部/研发部/后端组”时，应同时存在“总部”和“总部/研发部”。
- `排序` 可不填写，前端按 `0` 处理；数值越小，在同级部门中越靠前。
- `部门说明` 可不填写，最长 500 个字符。
- 如果完整路径已经存在且部门为 `ACTIVE`，后端会复用该部门，不覆盖已有名称、排序和说明。
- 如果匹配到的已有部门为 `DISABLED`，必须先启用部门或修改导入路径。

**Sheet 2：人员**

| 姓名 | 登录账号（可选） | 部门路径 |
| --- | --- | --- |
| 张三 |  | 总部/研发部/后端组 |
| 李四 | lisi | 总部/研发部 |
| 王五 |  | 总部/销售部 |

人员填写规则：

- `姓名` 必填，最长 120 个字符。
- `登录账号` 可以留空；前端根据姓名拼音生成建议，例如“张三”建议为 `zhangsan`。
- 最终提交后端前，每个人必须有确定的登录账号。
- 登录账号长度为 3～32 位，只允许英文字母和数字，不允许中文、空格、下划线或其他特殊字符。
- 账号不区分大小写；`ZhangSan` 和 `zhangsan` 在同一租户内视为同一个账号。
- 同名或拼音相同导致账号冲突时，由租户管理员在预览页面修改，例如改成 `zhangsan2`。
- `部门路径` 必填，并且必须能够匹配“部门”Sheet 中的一条完整路径。
- 人员 Sheet 不填写角色编码。默认角色由管理员在导入页面统一选择，特殊成员可以在预览页面单独覆盖。
- 第一版只创建新成员，不覆盖已有成员，也不支持通过批量导入分配 `tenant_admin`。

#### 20.5.2 导入页面需要管理员选择的内容

Excel 解析完成后，前端应展示以下批次设置：

```text
默认角色：   [普通员工 ▼]
激活有效期： [7 天 ▼]
```

- 前端通过 `GET /api/v1/roles` 查询当前租户角色，页面显示角色名称，提交时使用角色 UUID。
- 默认角色必须至少选择一个，普通成员统一使用批次默认角色。
- 特殊成员可以在预览表中单独选择角色；成员单独设置角色后，不再继承批次默认角色。
- 页面必须过滤或禁用 `tenant_admin`。即使前端没有过滤，后端也会拒绝导入。
- 激活有效期支持 1～30 天，默认 7 天。

#### 20.5.3 前端如何把 Excel 转换成 JSON

管理员不需要填写 `clientRef`。前端可以按 Excel 行号生成临时引用，例如：

```text
部门 Sheet 第 2 行 → department-row-2
部门 Sheet 第 3 行 → department-row-3
人员 Sheet 第 2 行 → member-row-2
```

对于部门路径“总部/研发部”，前端转换结果是：

```json
{
  clientRef: department-row-3,
  name: 研发部,
  parentClientRef: department-row-2,
  sortOrder: 10,
  description: 产品研发部门
}
```

人员“张三”关联“总部/研发部/后端组”时，前端通过路径找到对应部门的 `clientRef`：

```json
{
  clientRef: member-row-2,
  account: zhangsan,
  displayName: 张三,
  departmentClientRef: department-row-4
}
```

完整请求示例：

```json
{
  defaultRoleIds: [
    70000000-0000-0000-0000-000000000001
  ],
  departments: [
    {
      clientRef: department-row-2,
      name: 总部,
      parentClientRef: null,
      sortOrder: 0,
      description: 公司总部
    },
    {
      clientRef: department-row-3,
      name: 研发部,
      parentClientRef: department-row-2,
      sortOrder: 10,
      description: 产品研发部门
    },
    {
      clientRef: department-row-4,
      name: 后端组,
      parentClientRef: department-row-3,
      sortOrder: 10,
      description: 后端研发小组
    }
  ],
  members: [
    {
      clientRef: member-row-2,
      account: zhangsan,
      displayName: 张三,
      departmentClientRef: department-row-4
    },
    {
      clientRef: member-row-3,
      account: lisi,
      displayName: 李四,
      departmentClientRef: department-row-3,
      roleIds: [
        70000000-0000-0000-0000-000000000002
      ]
    }
  ],
  activationExpiresInDays: 7
}
```

角色使用规则：

```text
成员存在 roleIds    → 使用成员自己的 roleIds
成员不存在 roleIds  → 使用批次 defaultRoleIds
```

单批最多提交 200 个部门和 500 名成员，JSON 请求体最大 2 MiB。前端也应使用相同限制，避免管理员填写完成后才发现无法提交。

#### 20.5.4 调用校验接口

```http
POST /api/v1/tenants/current/organization-imports/validate
Authorization: Bearer <tenant-access-token>
Content-Type: application/json
```

校验接口不写入任何正式部门或成员数据。校验通过示例：

```json
{
  success: true,
  data: {
    valid: true,
    summary: {
      departmentCount: 3,
      departmentCreateCount: 2,
      departmentReuseCount: 1,
      memberCount: 2
    },
    departments: [
      {
        clientRef: department-row-2,
        action: REUSE,
        departmentId: 60000000-0000-0000-0000-000000000001,
        path: 总部
      },
      {
        clientRef: department-row-3,
        action: CREATE,
        departmentId: null,
        path: 总部/研发部
      }
    ],
    members: [
      {
        clientRef: member-row-2,
        account: zhangsan,
        displayName: 张三,
        departmentClientRef: department-row-4,
        departmentPath: 总部/研发部/后端组,
        effectiveRoleIds: [70000000-0000-0000-0000-000000000001]
      }
    ],
    issues: []
  },
  requestId: request-id
}
```

- `valid=true` 表示可以进入确认步骤；`valid=false` 表示必须先处理 `issues`。
- `departmentCreateCount` 是即将新建的部门数量。
- `departmentReuseCount` 是匹配到已有启用部门并直接复用的数量。
- `action=CREATE` 时尚未创建正式部门，因此 `departmentId=null`。
- `effectiveRoleIds` 是应用默认角色或成员专属角色后的最终角色集合。

业务校验失败仍返回 HTTP `200`，示例：

```json
{
  "success": true,
  "data": {
    "valid": false,
    "summary": {
      "departmentCount": 3,
      "departmentCreateCount": 2,
      "departmentReuseCount": 1,
      "memberCount": 2
    },
    "departments": [],
    "members": [],
    "issues": [
      {
        "scope": "MEMBER",
        "clientRef": "member-row-2",
        "field": "account",
        "code": "ORGANIZATION_IMPORT_ACCOUNT_EXISTS",
        "message": "账号 zhangsan 已被当前租户使用或存在有效邀请"
      }
    ]
  },
  "requestId": "request-id"
}
```

前端应使用 `clientRef` 找回对应 Excel 行。例如 `member-row-2` 对应人员 Sheet 第 2 行，并在预览表中直接标红该行。只有 DTO 结构、字段长度、格式或数组数量不合法时，接口才返回 HTTP `400`。

#### 20.5.5 调用确认导入接口

只有 `validate` 返回 `valid=true` 时，前端才应允许管理员点击“确认导入”。确认接口使用与校验接口完全相同的请求体：

```http
POST /api/v1/tenants/current/organization-imports/confirm
Authorization: Bearer <tenant-access-token>
Content-Type: application/json
```

后端不会直接信任之前的校验结果，而是在可串行化事务中重新检查账号、部门和角色。任意一项失败时整个事务回滚，不会出现只创建一部分成员的情况。

确认成功响应示例：

```json
{
  "success": true,
  "data": {
    "summary": {
      "departmentCount": 3,
      "departmentCreateCount": 2,
      "departmentReuseCount": 1,
      "memberCount": 2
    },
    "departments": [
      {
        "clientRef": "department-row-2",
        "departmentId": "60000000-0000-0000-0000-000000000001",
        "action": "REUSE",
        "path": "总部"
      },
      {
        "clientRef": "department-row-3",
        "departmentId": "60000000-0000-0000-0000-000000000002",
        "action": "CREATE",
        "path": "总部/研发部"
      }
    ],
    "members": [
      {
        "clientRef": "member-row-2",
        "membershipId": "50000000-0000-0000-0000-000000000001",
        "displayName": "张三",
        "account": "zhangsan",
        "departmentId": "60000000-0000-0000-0000-000000000003",
        "departmentPath": "总部/研发部/后端组",
        "tenantCode": "cees",
        "activationToken": "一次性明文激活令牌",
        "activationExpiresAt": "2026-09-16T00:00:00.000Z"
      }
    ]
  },
  "requestId": "request-id"
}
```

确认成功后，后端在同一事务中创建：

```text
User
TenantMembership：PENDING_ACTIVATION，passwordHash=null
MembershipRole
TenantInvitation：保存激活令牌 Hash
TenantInvitationRole
```

明文 `activationToken` 只在本次响应中返回，不写入数据库明文字段、应用日志或审计元数据。前端收到响应后应立即完成 Excel 导出，不应长期保存在浏览器日志、错误监控或本地缓存中。

#### 20.5.6 前端生成激活凭证 Excel

确认成功后，前端应立即下载另一个 Excel。这个文件不是管理员上传的原始导入文件，而是发给员工的激活凭证文件。

| 姓名 | 部门 | 租户编码 | 登录账号 | 激活码 | 过期时间 |
| --- | --- | --- | --- | --- | --- |
| 张三 | 总部/研发部/后端组 | cees | zhangsan | 一次性激活令牌 | 2026-09-16 08:00:00 |
| 李四 | 总部/研发部 | cees | lisi | 一次性激活令牌 | 2026-09-16 08:00:00 |

建议文件名：

```text
成员激活凭证-cees-20260909.xlsx
```

员工拿到凭证后调用 `POST /api/v1/auth/activate`：

```json
{
  "tenantCode": "cees",
  "account": "zhangsan",
  "invitationToken": "激活凭证中的一次性激活码",
  "password": "change_me"
}
```

激活成功后，成员状态从 `PENDING_ACTIVATION` 变为 `ACTIVE`，之后使用 `tenantCode + account + password` 登录。

如果确认接口响应丢失，原明文激活码无法从数据库恢复。管理员需要调用 `POST /api/v1/tenants/current/members/{membershipId}/credential-reset`，为对应成员重新生成激活凭证。

#### 20.5.7 常见问题与错误处理

| 错误码 | 含义 | 处理方式 |
| --- | --- | --- |
| `ORGANIZATION_IMPORT_CLIENT_REF_DUPLICATE` | 前端生成的临时引用重复 | 检查前端行号或路径映射逻辑 |
| `ORGANIZATION_IMPORT_PARENT_NOT_FOUND` | 上级部门引用不存在 | 补齐父路径或修正部门路径 |
| `ORGANIZATION_IMPORT_DEPARTMENT_DUPLICATE` | 当前批次存在同级重名部门 | 删除重复路径或修改部门名称 |
| `ORGANIZATION_IMPORT_DEPARTMENT_CYCLE` | 部门父子关系形成循环 | 修正前端部门树构建逻辑 |
| `ORGANIZATION_IMPORT_DEPARTMENT_DEPTH_EXCEEDED` | 部门超过 10 级 | 调整组织层级 |
| `ORGANIZATION_IMPORT_DEPARTMENT_DISABLED` | 匹配到已停用部门 | 先启用部门或修改路径 |
| `ORGANIZATION_IMPORT_MEMBER_DEPARTMENT_NOT_FOUND` | 人员引用的部门无效 | 检查人员 Sheet 的部门路径 |
| `ORGANIZATION_IMPORT_ACCOUNT_DUPLICATE` | 同一批次内账号重复 | 在预览页修改其中一个账号 |
| `ORGANIZATION_IMPORT_ACCOUNT_EXISTS` | 账号已存在或有有效邀请 | 修改账号或处理原邀请 |
| `ORGANIZATION_IMPORT_ROLE_NOT_FOUND` | 角色不存在或已删除 | 刷新角色列表并重新选择 |
| `ORGANIZATION_IMPORT_TENANT_ADMIN_FORBIDDEN` | 尝试批量分配租户管理员 | 使用普通角色导入，再通过正式管理员流程设置 |
| `ORGANIZATION_IMPORT_CONFLICT` | 校验后到确认前发生并发冲突 | 重新调用 `validate` 并再次确认 |

接口要求当前成员同时拥有 `department.create`、`member.invite` 和 `role.assign`。成功确认会写入一条 `ORGANIZATION_MEMBERS_IMPORTED` 汇总审计，记录部门创建数、复用数、成员数和激活过期时间，不记录明文激活码。

#### 20.5.8 验收检查清单

1. 已有启用部门显示为 `REUSE`，并且确认后没有被重复创建。
2. 新部门显示为 `CREATE`，父子关系和排序正确。
3. 重复账号能够定位到具体人员 Excel 行。
4. 无效角色、停用部门、循环部门和超过 10 级部门不能确认导入。
5. 确认成功后成员状态为 `PENDING_ACTIVATION`，部门和角色分配正确。
6. 每名成员获得不同的激活码，数据库和审计中没有明文激活码。
7. 任意数据失败时整批回滚，不产生半成品部门或成员。
8. 激活成功后成员能够使用租户编码、账号和新密码登录。

更偏设计和边界说明的内容见 [组织架构与成员批量导入](organization-member-import.md)。

### 20.6 项目与项目成员

先创建项目：

```json
{
  "code": "PRJ-2026-001",
  "name": "AI 工作台",
  "description": "企业内部 AI 协作平台",
  "departmentId": null,
  "startsAt": "2026-09-08T00:00:00.000Z",
  "endsAt": "2026-12-31T00:00:00.000Z"
}
```

不传 `ownerMembershipId` 时当前成员自动成为 `OWNER`。建议按以下顺序验证：

```text
POST /api/v1/projects
GET  /api/v1/projects
POST /api/v1/projects/{projectId}/members
PUT  /api/v1/projects/{projectId}/owner
POST /api/v1/projects/{projectId}/start
POST /api/v1/projects/{projectId}/complete
POST /api/v1/projects/{projectId}/archive
```

完成请求示例：

```json
{
  "completionSummary": "项目已验收",
  "version": 3
}
```

如果项目存在 `TODO/IN_PROGRESS/BLOCKED` 任务，完成接口返回 `409 PROJECT_HAS_UNFINISHED_TASKS`。完成后修改资料和成员会返回 `409 PROJECT_READ_ONLY`，继续工作必须先调用 `reopen`。

### 20.7 创建并查询受控文档

调用 `POST /api/v1/documents`：

```json
{
  "title": "本地测试文档",
  "content": "用于验证文档、资源、权限和审计链路。",
  "visibility": "PRIVATE"
}
```

然后调用：

```text
GET /api/v1/documents
GET /api/v1/documents/{documentId}
GET /api/v1/resources/{resourceId}/acl
GET /api/v1/audit-events
```

文档创建成功后，`documents` 知识库表不会变化；应查看 `managed_documents`、`resources` 和 `audit_logs`。

### 20.8 验证 COS 基础直传

使用租户 Access Token 和客户端生成的 `Idempotency-Key` 创建上传会话：

```http
POST /api/v1/upload-sessions
Idempotency-Key: desktop-upload-0001
```

```json
{
  "purpose": "attachment",
  "fileName": "项目方案.pdf",
  "contentType": "application/pdf",
  "sizeBytes": 1024
}
```

客户端按照响应中的 PUT URL 和请求头直传 COS 后，再调用：

```http
POST /api/v1/upload-sessions/{uploadSessionId}/complete
```

API 只有在 COS HEAD 返回的大小和 Content-Type 与会话一致时才创建 `file_objects`。当前基础范围、支持格式、对象键和暂缓能力统一见 [文件上传与 COS 设计](../architecture/file-upload.md)。

## 21. `0.8.0` 迁移说明

- 新增租户组织部门树的 7 个公开接口和 5 个部门权限；
- `tenant_admin` 自动获得新增部门权限，自定义角色可按需授权；
- `departments` 新增规范化名称、说明、排序、状态和父子自关联约束；
- 根部门在租户内同名唯一，子部门在同一父部门下同名唯一，软删除后名称可复用；
- 原成员修改接口修改 `departmentId` 时也必须拥有 `department.member.assign`；
- 数据库迁移 `0003_organization_departments_and_database_comments` 同时补齐 39 张业务表和 422 个业务字段的 PostgreSQL 注释；
- 公开契约版本由 `0.7.0` 提升为 `0.8.0`，并新增可重复生成 `packages/api-client` 的脚本。

## 22. `0.9.0` 迁移说明

- 新增 `GET /users/me/profile` 和 `PATCH /users/me/profile`；
- 个人资料属于当前租户成员身份，仅允许本人修改当前租户展示名；
- 账号保持只读，邮箱、手机和头像修改暂缓；本人密码修改已在 `0.10.0` 落地；
- 修改使用 `tenant_memberships.version` 乐观锁并写入 `USER_PROFILE_UPDATED` 审计事件；
- 复用现有成员字段，不需要新增 Prisma migration。
- 新增创建和完成单文件 COS 直传会话的 2 个公开接口；
- 对象键固定为 `cees/{environment}/tenants/{tenantId}/files/{yyyy}/{mm}/{fileId}/source`；
- 新增 `UploadSession`，并扩展 `FileObject` 的原始文件名、用途、存储提供商、Bucket、Region 和 ETag；
- 数据库迁移为 `0004_redis_cos_upload_foundation`，新增结构均包含 PostgreSQL 中文注释；
- 公开契约版本由 `0.8.0` 提升为 `0.9.0`；
- 当前尚未启用 `file.*` 细粒度权限、租户额度、分片、安全扫描和 AI 入库。

## 23. `0.10.0` 迁移说明

- 新增 `POST /auth/change-password` 和 `POST /platform/auth/change-password`；
- 两个接口都要求有效 Access Token，并校验当前密码；
- 新密码不能与当前密码相同，成功后保留当前 Session 并撤销其他 Session；
- 租户与平台分别写入独立的成功或失败审计事件，审计中不保存密码或密码 Hash；
- 复用现有密码和 Session 字段，不需要新增 Prisma migration。

## 24. `0.11.0` 迁移说明

- 新增项目 CRUD、项目成员、负责人转移和 8 个项目状态命令，共 18 个公开 HTTP 操作；
- 项目默认只有项目成员可见，`project.manage_all` 才能跨项目管理当前租户项目；
- 新增 10 个 `project.*` 权限，系统 `tenant_admin` 通过 seed 自动获得；
- 项目成员从全局 `user_id` 改为租户 `membership_id`，避免跨租户身份混淆；
- 项目增加租户内唯一编码、唯一负责人、开始结束时间和完成信息；
- 新增 `project_status_history`，所有状态命令同时写入状态历史和租户审计；
- `COMPLETED/CANCELLED/ARCHIVED` 项目只读，完成项目要求不存在未完成任务；
- 数据库迁移为 `0005_project_management`，新表、枚举和字段包含 PostgreSQL 中文注释；
- 公开契约版本由 `0.10.0` 提升为 `0.11.0`。

## 25. `0.12.0` 迁移说明

- 新增组织架构和成员批量校验、确认导入 2 个公开 HTTP 操作；
- Excel 由前端解析，API 只接收标准 JSON，单批限制为 200 个部门、500 名成员和 2 MiB 请求体；
- 已有启用部门按完整路径复用，不修改原资料；第一版只创建新成员；
- 成员在同一事务中创建为 `PENDING_ACTIVATION`，同时创建角色关系和独立一次性激活凭证；
- 批量导入禁止分配 `tenant_admin`，确认接口要求 `department.create`、`member.invite` 和 `role.assign`；
- 新增 `ORGANIZATION_MEMBERS_IMPORTED` 汇总审计，明文激活令牌不会进入日志或审计；
- 复用现有数据模型，不需要新增 Prisma migration；公开契约版本由 `0.11.0` 提升为 `0.12.0`。
