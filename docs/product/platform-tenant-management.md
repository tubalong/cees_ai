# 平台租户与管理员管理

## 当前实现

- 超级管理员可以点击平台租户列表中的租户，打开详情与管理员抽屉。
- 租户详情展示状态、版本、有效管理员数、待激活邀请数和创建时间。
- 平台操作全部使用平台 Access Token，与租户认证域完全隔离。

## 租户管理

- `GET /platform/tenants/{tenantId}`：加载租户详情。
- `PATCH /platform/tenants/{tenantId}`：提交 `name + version` 修改租户名称。
- `POST /platform/tenants/{tenantId}/suspend`：提交 `reason + version` 停用租户并撤销其全部租户 Session。
- `POST /platform/tenants/{tenantId}/restore`：提交 `version` 恢复租户；旧 Session 不恢复，成员必须重新登录。
- 所有修改使用详情接口返回的当前 `version`，冲突时不自动覆盖。

## 租户管理员管理

- `GET /platform/tenants/{tenantId}/administrators`：查询已激活租户管理员。
- `POST /platform/tenants/{tenantId}/administrators`：按账号处理管理员分配。
- 账号已存在于该租户时，服务端直接分配 `tenant_admin` 系统角色。
- 账号不存在时，服务端创建管理员邀请并返回一次性 `invitationToken`。
- 一次性令牌只在当前弹窗展示，可复制但不写入本地存储或日志。
- `DELETE /platform/tenants/{tenantId}/administrators/{membershipId}`：取消管理员角色，但保留普通租户成员身份。
- 最后一名有效租户管理员等限制由服务端强制校验。

## 账号编辑边界

- 当前平台公开接口没有直接修改租户管理员登录账号的 PATCH 操作。
- 平台超级管理员可以新增、邀请或取消租户管理员，不能凭空修改 Membership 账号。
- 登录账号修改应由该租户内具备 `member.account.update` 权限的企业管理员调用 `PATCH /tenants/current/members/{membershipId}/account`。
- 账号修改成功后服务端会撤销目标成员已有 Session，避免旧账号会话继续使用。
- 如果产品需要超级管理员直接修改租户成员账号，必须由后端新增平台域专用接口、权限和平台审计，客户端不能复用租户 Token 接口绕过认证域。