# 平台租户管理与租户账号激活

> 状态：已实现
> 最后同步：2026-09-07
> 契约版本：`0.7.0`

## 1. 目标与边界

平台超级管理员负责租户生命周期、首位租户管理员和平台审计。租户管理员负责当前租户的成员账号、角色和凭证重置。普通用户不能通过注册创建租户，租户只能由平台超级管理员创建。

平台管理员和租户成员使用独立认证域：

- 平台管理员使用全局唯一 `account + password`；
- 租户成员使用 `tenantCode + account + password`；
- 两类身份使用独立 JWT、Session、Guard 和权限命名空间。

## 2. 账号规则

- 账号只允许英文字母和数字，格式为 `^[a-zA-Z0-9]+$`；
- 长度为 3～32 个字符；
- 账号统一转为小写保存，并使用 `normalizedAccount` 参与比较；
- 同一租户内账号大小写不敏感且不可重复；
- 不同租户可以使用相同账号；
- 数据库技术主键仍使用 UUID，业务唯一约束为 `tenantId + normalizedAccount`；
- 删除成员后账号仍不自动释放，避免审计身份混淆。

系统可以根据成员姓名生成全拼账号建议，例如“张三”生成 `zhangsan`。拼音结果只是建议，多音字和同名冲突由租户管理员最终裁定。发生冲突时服务端返回 `409 TENANT_ACCOUNT_ALREADY_EXISTS` 和可用替代建议，不会静默修改账号。

## 3. 身份与凭证模型

```text
User                         # 内部人员资料，UUID 主键
├── PlatformAdministrator    # 平台账号、平台密码和平台锁定状态
│   └── PlatformAuthSession
└── TenantMembership         # 租户账号、租户密码和租户锁定状态
    └── AuthSession

TenantInvitation             # 一次性账号激活或凭证重置令牌
└── TenantInvitationRole
```

租户账号的 `passwordHash`、失败次数、锁定时间和最后登录时间保存在 TenantMembership。这样一个用户在不同租户的账号和锁定状态互不影响。平台管理员的相同字段保存在 PlatformAdministrator，不复用租户凭证。

User 的邮箱和密码字段在兼容迁移阶段保留为可空字段，但认证流程不再依赖邮箱。

## 4. 租户创建与首位管理员

`POST /platform/tenants` 接收租户编码、名称和首位管理员姓名，可选接收管理员账号。未填写账号时由服务端根据姓名生成拼音账号。

服务端在串行化事务中：

1. 创建状态为 `PENDING_ACTIVATION` 的 Tenant；
2. 创建 `tenant_admin` 系统角色及完整租户权限；
3. 创建账号型 TenantInvitation；
4. 返回只出现一次的 `invitationToken`；
5. 首位管理员调用 `/auth/activate` 设置密码；
6. 创建 TenantMembership 并将租户切换为 `ACTIVE`。

令牌在数据库中只保存 SHA-256 Hash，默认 24 小时过期。调用方必须通过企业内部受控渠道交付租户编码、账号和激活令牌。

## 5. 租户状态机

```text
PENDING_ACTIVATION --首位管理员激活账号--> ACTIVE
ACTIVE ------------平台管理员停用-------> SUSPENDED
SUSPENDED ---------存在有效管理员并恢复--> ACTIVE
```

停用租户会撤销该租户全部未撤销 AuthSession。恢复租户不会恢复旧 Session，用户必须重新登录。

## 6. 成员账号流程

### 6.1 创建账号邀请

租户管理员先调用账号建议接口，再提交最终账号：

```text
POST /tenants/current/account-suggestions
POST /tenants/current/invitations
```

邀请输入包含 `displayName`、可选 `account` 和 `roleIds`。如果不传 account，后端使用姓名拼音生成。有效邀请会占用该账号，防止并发管理员重复分配。

### 6.2 激活账号

```text
POST /auth/activate
```

请求必须提供：

```text
tenantCode + account + invitationToken + password
```

激活成功后创建或恢复租户成员凭证，令牌立即失效。首位管理员激活时同时激活租户。

### 6.3 修改账号

```text
PATCH /tenants/current/members/{membershipId}/account
```

账号修改要求 `member.account.update` 权限和乐观锁版本。修改成功后撤销目标成员全部 Session，并记录修改前后账号。

### 6.4 重置凭证

```text
POST /tenants/current/members/{membershipId}/credential-reset
```

凭证重置要求 `member.credential.reset` 权限。服务端会撤销目标成员全部 Session、清空旧密码、把成员置为 `PENDING_ACTIVATION` 并签发新的一次性激活令牌。不能重置当前登录成员自己，也不能让最后一名有效租户管理员进入待激活状态。

由于当前不绑定邮箱和手机号，用户忘记密码时必须联系租户管理员执行此流程。

## 7. 接口

### 平台认证

```text
POST /platform/auth/login
POST /platform/auth/refresh
POST /platform/auth/logout
GET  /platform/auth/me
```

### 平台租户管理

```text
GET    /platform/tenants
POST   /platform/tenants
GET    /platform/tenants/{tenantId}
PATCH  /platform/tenants/{tenantId}
POST   /platform/tenants/{tenantId}/suspend
POST   /platform/tenants/{tenantId}/restore
GET    /platform/tenants/{tenantId}/administrators
POST   /platform/tenants/{tenantId}/administrators
DELETE /platform/tenants/{tenantId}/administrators/{membershipId}
```

### 租户账号管理

```text
POST   /tenants/current/account-suggestions
GET    /tenants/current/invitations
POST   /tenants/current/invitations
DELETE /tenants/current/invitations/{invitationId}
POST   /auth/activate
PATCH  /tenants/current/members/{membershipId}/account
POST   /tenants/current/members/{membershipId}/credential-reset
```

### 平台审计

```text
GET /platform/audit-events
GET /platform/audit-events/{auditEventId}
```

## 8. 权限与审计

租户管理员权限目录包括：

```text
member.invite
member.account.update
member.credential.reset
```

关键审计事件包括：

```text
TENANT_ACCOUNT_INVITATION_CREATED
TENANT_ACCOUNT_INVITATION_REVOKED
TENANT_ACCOUNT_ACTIVATED
TENANT_MEMBER_ACCOUNT_CHANGED
TENANT_MEMBER_CREDENTIAL_RESET
TENANT_MEMBER_CREDENTIAL_ACTIVATED
```

平台操作继续写 PlatformAuditLog，涉及目标租户的操作同时写入目标租户 AuditLog。

## 9. 数据库与配置

- Prisma migration：`0007_platform_tenant_administration`；
- TenantMembership 新增租户账号、密码和锁定字段；
- PlatformAdministrator 新增独立平台账号、密码和锁定字段；
- TenantInvitation 改为保存账号、姓名和可选目标成员；
- `TENANT_INVITATION_TTL` 默认 `1d`；
- `SEED_ADMIN_ACCOUNT` 默认 `admin`；
- `SEED_PLATFORM_ADMIN_ACCOUNT` 默认 `superadmin`；
- Production 必须提供独立且非 `change_me` 的 `JWT_PLATFORM_ACCESS_SECRET`。

## 10. 暂缓项

- 手机和邮箱绑定；
- 用户自助找回密码；
- 企业微信、钉钉或短信自动交付激活令牌；
- 平台管理员多级角色和自助凭证管理；
- 管理员交接审批和二次确认。
