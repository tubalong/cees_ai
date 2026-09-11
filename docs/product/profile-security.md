# 个人资料与账号安全

## 当前实现

- Desktop 左侧导航底部提供独立“个人中心”和“退出登录”入口。
- 个人中心通过 `GET /users/me/profile` 加载当前租户内的账号、显示名称、部门、版本和更新时间。
- 用户可调用 `PATCH /users/me/profile` 修改当前租户内的显示名称。
- 用户可调用 `POST /auth/change-password` 修改当前租户成员密码。

## 修改显示名称

请求体包含：

```json
{
  "displayName": "新名称",
  "version": 4
}
```

- `displayName` 长度为 1～120 字符。
- `version` 来自最近一次 Profile 查询，用于乐观锁。
- 修改成功后更新 Profile 查询缓存和 App 身份上下文，首页问候语立即同步。
- 显示名称属于当前租户 Membership 范围，不改变其他租户内的展示名称。

## 修改密码

请求体包含：

```json
{
  "currentPassword": "current_password",
  "newPassword": "new_password"
}
```

- 当前密码和新密码长度均为 8～128 字符。
- 客户端要求再次输入新密码并在本地完成一致性校验。
- 修改成功后服务端撤销当前成员的其他登录会话，当前操作会话保留。
- 客户端不保存、记录或回显当前密码和新密码。

## 租户边界

- 两个接口都使用租户 Access Token，不接受客户端提交 `tenantId`、`membershipId` 或 `userId`。
- 资料修改仅影响当前 Token 对应的租户成员身份。
- 客户端界面控制不替代服务端身份、Session、租户和权限校验。