# IAM、租户、RBAC、ACL 与审计 API 设计草案

> 状态：第一期 Auth、Tenant、Member、RBAC、Document、ACL 与 Audit 共 28 个接口已实现
> 版本：0.5.0
> 更新日期：2026-09-07
> 适用范围：CEES AI 第一期身份认证与授权基础能力

## 1. 文档目标

本文档定义 CEES AI 第一期以下能力的 HTTP API：

- 身份与令牌（Auth）；
- 租户与成员（Tenant / Membership）；
- 权限与角色（RBAC）；
- 受控业务资源与资源级授权（ACL）；
- 安全审计（Audit）。

本文档是接口设计草案，不替代 OpenAPI 契约。实现前必须将确认后的接口同步到
`packages/contracts/openapi/openapi.yaml`，并重新生成受影响客户端。

## 2. 架构边界

- NestJS API 是用户、租户、角色、权限、ACL、Session 和审计事件的唯一业务事实源。
- 客户端不自行决定租户上下文或授权结果。
- 当前租户由服务端从 Access Token 解析，并通过 Session 和 Membership 再次确认。
- AI 服务不参与登录、租户、RBAC 或 ACL 决策，也不得修改相关业务数据。
- Audit 写入仅由服务端内部业务代码触发，不提供客户端写接口。

授权规则：

```text
允许 = 身份有效
    AND Session 有效
    AND 租户有效
    AND 成员关系有效
    AND RBAC 拥有操作权限
    AND 资源属于当前租户
    AND ACL/所有权/可见性允许访问
```

所有条件默认拒绝。第一期 ACL 只支持允许授权，不设计显式拒绝规则。

## 3. 通用约定

### 3.1 基础地址

```text
http://localhost:3000/api/v1
```

### 3.2 鉴权方式

除公开接口外，请求必须携带：

```http
Authorization: Bearer <access-token>
```

Access Token 建议包含：

```json
{
  sub: user-id,
  tid: tenant-id,
  mid: membership-id,
  sid: session-id,
  av: 1,
  jti: token-id,
  iss: cees-api,
  aud: cees-client
}
```

Token 中不保存完整权限列表。服务端根据 Membership、Role 和 Permission 计算最终权限。

### 3.3 当前租户

普通租户业务接口不接收 `tenantId` 作为授权依据。当前租户始终来自经过验证的 Access Token。

登录时的 `tenantCode`、切换租户时的目标租户，以及 ACL 中的目标主体仅表示用户请求的目标，
服务端仍必须验证对应关系属于当前用户和当前租户。

### 3.4 通用格式

- 实体 ID 使用不透明字符串，推荐 UUID；
- 时间使用 ISO 8601 UTC，例如 `2026-09-04T08:30:00Z`；
- 列表接口使用游标分页；
- `limit` 默认 20，最大 100；
- `cursor` 是服务端生成的不透明字符串。

列表响应：

```json
{
  items: [],
  nextCursor: null
}
```

统一错误响应：

```json
{
  code: AUTH_INVALID_CREDENTIALS,
  message: 邮箱或密码错误,
  requestId: request-id,
  details: null
}
```

登录失败不得通过错误信息区分租户不存在、用户不存在和密码错误。

### 3.5 HTTP 状态码

| 状态码 | 使用场景 |
| --- | --- |
| `200` | 查询、更新或普通操作成功 |
| `201` | 资源创建成功 |
| `204` | 删除、退出或撤销成功 |
| `400` | 请求字段校验失败 |
| `401` | 未登录、Token 无效、Session 已失效 |
| `403` | 权限或资源范围不足 |
| `404` | 当前租户范围内资源不存在 |
| `409` | 唯一性或业务状态冲突 |
| `423` | 用户被临时锁定 |
| `429` | 请求触发限流 |

对于无权访问的具体资源，可根据防枚举策略统一返回 `404`。

## 4. 第一期接口总览

### 4.1 Auth：4 个

```text
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET  /auth/me
```

### 4.2 Tenant 与 Member：7 个

```text
GET    /tenants/current
PATCH  /tenants/current
GET    /tenants/current/members
GET    /tenants/current/members/{membershipId}
PATCH  /tenants/current/members/{membershipId}
DELETE /tenants/current/members/{membershipId}
PUT    /tenants/current/members/{membershipId}/roles
```

### 4.3 RBAC：7 个

```text
GET    /permissions
GET    /roles
POST   /roles
GET    /roles/{roleId}
PATCH  /roles/{roleId}
DELETE /roles/{roleId}
PUT    /roles/{roleId}/permissions
```

### 4.4 Document：5 个

Document 是第一种验证资源级授权的受控业务资源。

```text
GET    /documents
POST   /documents
GET    /documents/{documentId}
PATCH  /documents/{documentId}
DELETE /documents/{documentId}
```

### 4.5 ACL：3 个

```text
GET    /resources/{resourceId}/acl
POST   /resources/{resourceId}/acl
DELETE /resources/{resourceId}/acl/{aclEntryId}
```

### 4.6 Audit：2 个

```text
GET /audit-events
GET /audit-events/{auditEventId}
```

第一期共 28 个公开接口。

截至 2026-09-07，Auth 4 个、Tenant/Member 7 个、RBAC 7 个、Document 5 个、ACL 3 个和 Audit 2 个接口均已实现，共 28 个。

## 5. Auth API

| 方法 | 路径 | 鉴权 | 用途 |
| --- | --- | --- | --- |
| `POST` | `/auth/login` | 公开 | 租户编码、邮箱、密码登录 |
| `POST` | `/auth/refresh` | Refresh Token | 轮换令牌 |
| `POST` | `/auth/logout` | Access Token | 撤销当前 Session |
| `GET` | `/auth/me` | Access Token | 当前用户、租户、角色和权限 |

登录请求包含 `tenantCode`、`email`、`password` 和可选 `deviceName`。响应包含 Access Token、Refresh Token、User、Tenant 和 Membership。

密码使用 Argon2id；Refresh Token 只保存 Hash；登录失败使用统一错误；刷新时必须轮换 Token；登录、失败、刷新和退出均写入审计。

## 6. Tenant 与 Member API

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| `GET` | `/tenants/current` | `tenant.read` |
| `PATCH` | `/tenants/current` | `tenant.update` |
| `GET` | `/tenants/current/members` | `member.read` |
| `GET` | `/tenants/current/members/{membershipId}` | `member.read` |
| `PATCH` | `/tenants/current/members/{membershipId}` | `member.update` |
| `DELETE` | `/tenants/current/members/{membershipId}` | `member.remove` |
| `PUT` | `/tenants/current/members/{membershipId}/roles` | `role.assign` |

成员列表支持 `keyword`、`status`、`roleId`、`limit` 和 `cursor`。修改状态第一期只接受 `ACTIVE`、`DISABLED`。

停用或移除成员时必须撤销其当前租户 Session、清除权限缓存并写入审计。不能操作其他租户成员，也不能移除最后一名有效租户管理员。

角色设置接口使用 `PUT` 替换最终角色集合，Role 和 Membership 必须属于当前租户。

## 7. RBAC API

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| `GET` | `/permissions` | `role.read` |
| `GET` | `/roles` | `role.read` |
| `POST` | `/roles` | `role.create` |
| `GET` | `/roles/{roleId}` | `role.read` |
| `PATCH` | `/roles/{roleId}` | `role.update` |
| `DELETE` | `/roles/{roleId}` | `role.delete` |
| `PUT` | `/roles/{roleId}/permissions` | `role.update` |

Permission 是平台预置能力目录，不开放租户级写接口。角色 `code` 在租户内唯一且创建后不可修改，`name` 是展示名称，租户创建的角色默认不是系统角色。

角色权限接口使用 `PUT` 替换最终 Permission 集合。修改角色或权限后，必须清除受影响成员的授权缓存并写入审计。

系统角色不允许修改、替换权限或删除；仍被成员或 ACL 使用的角色不得删除，应返回 `409 Conflict`。角色修改、权限替换和删除均使用 `version` 做乐观锁控制。

## 8. Document 受控资源 API

Document 是第一种用于验证 RBAC、所有权、可见性和 ACL 的业务资源。

| 方法 | 路径 | 权限与范围 |
| --- | --- | --- |
| `GET` | `/documents` | `document.read` + SQL 授权过滤 |
| `POST` | `/documents` | `document.create` |
| `GET` | `/documents/{documentId}` | `document.read` + ACL |
| `PATCH` | `/documents/{documentId}` | `document.update` + ACL |
| `DELETE` | `/documents/{documentId}` | `document.delete` + ACL |

创建请求包含 `title`、`content` 和 `visibility`。第一期支持 `PRIVATE` 和 `TENANT` 两种可见性。

创建时在同一事务内创建 Resource、ManagedDocument、Owner 关系和审计事件。Document 与 Resource 共用同一个 ID，响应返回 `effectivePermissions`，供客户端展示操作按钮。

列表接口必须在 SQL 查询阶段按当前 `tenantId`、Owner、Visibility、Membership ACL、Role ACL 和 `document.manage_all` 过滤，禁止查询全部数据后在应用层逐条删除无权记录。

Document 删除采用软删除，同时软删除 Resource 和其 ACL；修改和删除通过 `version` 做乐观锁控制。

## 9. ACL API

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| `GET` | `/resources/{resourceId}/acl` | `<resourceType>.share` |
| `POST` | `/resources/{resourceId}/acl` | `<resourceType>.share` |
| `DELETE` | `/resources/{resourceId}/acl/{aclEntryId}` | `<resourceType>.share` |

创建授权请求：

```json
{
  "subjectType": "MEMBERSHIP",
  "subjectId": "membership-id",
  "permissionCodes": [
    "document.read",
    "document.update"
  ],
  "expiresAt": null
}
```

`subjectType` 第一期支持 `MEMBERSHIP` 和 `ROLE`。服务端验证 Resource、Membership 或 Role 均属于当前租户，且 ACL 权限限定为 `document.read`、`document.update`、`document.delete` 和 `document.share`。

ACL 只定义资源范围，不能绕过 RBAC。成员拥有 `document.update` ACL，但其角色没有 `document.update` 时，最终仍然拒绝更新。

授权和撤销分别写入 `ACL_GRANTED`、`ACL_REVOKED`。相同主体和相同内容的重复授权保持幂等，不同内容返回 `409 Conflict`；撤销通过 `version` 做乐观锁控制。

## 10. Audit API

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| `GET` | `/audit-events` | `audit.read` |
| `GET` | `/audit-events/{auditEventId}` | `audit.read` |

列表支持 `action`、`outcome`、`actorId`、`membershipId`、`resourceType`、`resourceId`、`requestId`、`from`、`to`、`limit` 和 `cursor`。

审计响应包含 `requestId`、操作类型、结果、操作者、资源、IP、User-Agent、非敏感 metadata 和创建时间。

`outcome` 支持 `SUCCESS` 和 `FAILURE`；分页按 `createdAt` 与 `id` 倒序，默认每页 50 条，最多 100 条。

只能查询当前租户事件。审计事件只能由服务端内部创建，禁止公开创建、修改和删除接口。metadata 不得保存密码、Token、Token Hash、Secret、完整文档内容或未经脱敏的请求体。

## 11. 第一期权限目录

| Permission | 说明 |
| --- | --- |
| `tenant.read` | 查看当前租户 |
| `tenant.update` | 修改当前租户 |
| `member.read` | 查看租户成员 |
| `member.update` | 启用或停用成员 |
| `member.remove` | 移除成员 |
| `role.read` | 查看 Permission 和 Role |
| `role.create` | 创建租户角色 |
| `role.update` | 修改角色及权限 |
| `role.delete` | 删除租户角色 |
| `role.assign` | 为成员分配角色 |
| `document.create` | 创建文档 |
| `document.read` | 读取授权范围内文档 |
| `document.update` | 修改授权范围内文档 |
| `document.delete` | 删除授权范围内文档 |
| `document.share` | 查询、授予和撤销文档 ACL |
| `document.manage_all` | 管理当前租户全部文档 |
| `audit.read` | 查询当前租户审计事件 |

## 12. 建议审计事件

```text
AUTH_LOGIN_SUCCEEDED
AUTH_LOGIN_FAILED
AUTH_ACCOUNT_LOCKED
AUTH_TOKEN_REFRESHED
AUTH_REFRESH_REUSE_DETECTED
AUTH_LOGOUT
AUTH_SESSION_REVOKED

TENANT_UPDATED
TENANT_MEMBER_DISABLED
TENANT_MEMBER_ENABLED
TENANT_MEMBER_REMOVED

ROLE_CREATED
ROLE_UPDATED
ROLE_DELETED
ROLE_PERMISSION_CHANGED
ROLE_ASSIGNED
ROLE_REVOKED

RESOURCE_CREATED
RESOURCE_UPDATED
RESOURCE_DELETED
ACL_GRANTED
ACL_REVOKED
ACCESS_DENIED
```

## 13. 不开放的公开接口

以下能力仅作为 NestJS 内部服务存在：

```text
POST   /authorization/check
POST   /audit-events
PATCH  /audit-events/{auditEventId}
DELETE /audit-events/{auditEventId}
POST   /sessions/validate
POST   /permissions
PATCH  /permissions/{permissionId}
DELETE /permissions/{permissionId}
```

业务模块通过内部 `AuthorizationService` 和 `AuditService` 完成权限判断及审计写入。

## 14. 第二期候选接口

```text
GET    /auth/sessions
DELETE /auth/sessions/{sessionId}
DELETE /auth/sessions/others
GET    /auth/tenants
POST   /auth/switch-tenant
POST   /auth/change-password

GET    /tenants/current/invitations
POST   /tenants/current/invitations
DELETE /tenants/current/invitations/{invitationId}
POST   /tenant-invitations/accept

PATCH  /resources/{resourceId}/access-policy
GET    /resources/{resourceId}/effective-permissions
POST   /resources/{resourceId}/transfer-ownership
POST   /audit-events/export
```

平台级租户创建、停用和恢复接口应与租户业务 API 分离，并使用独立 Platform Admin 权限体系。

## 15. 第一期验收链路

1. 租户管理员通过 `/auth/login` 登录；
2. 通过 `/auth/me` 获取当前身份、角色和权限；
3. 查询租户成员；
4. 创建文档审核角色并配置 `document.read`；
5. 将角色分配给普通成员；
6. 管理员创建 `PRIVATE` Document；
7. 普通成员有 `document.read`，但无 ACL，访问被拒绝；
8. 管理员授予该成员 `document.read` ACL；
9. 普通成员可以读取 Document；
10. 管理员撤销 ACL；
11. 普通成员再次访问被拒绝；
12. 审计接口能够查询登录、角色分配、资源创建、ACL 变更和拒绝访问事件。

## 16. OpenAPI 落地顺序

1. 定义统一错误、分页、User、Tenant 和 Membership Schema；
2. 定义 Auth 接口与 Bearer Security Scheme；
3. 定义 Tenant 和 Member 接口；
4. 定义 Permission、Role 和角色分配接口；
5. 定义 Resource、Document 和 ACL 接口；
6. 定义 Audit 查询接口；
7. 执行契约校验并生成 TypeScript 客户端；
8. 增加 NestJS 契约集成测试。
