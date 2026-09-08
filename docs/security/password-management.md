# 密码修改与凭证安全

> 状态：已实现，公开契约版本 `0.10.0`
>
> 适用范围：租户成员和平台超级管理员修改自己的当前密码

## 1. 接口

| 身份域 | 方法与路径 | 鉴权 |
| --- | --- | --- |
| 租户成员 | `POST /api/v1/auth/change-password` | 租户 Bearer Token |
| 平台管理员 | `POST /api/v1/platform/auth/change-password` | 平台 Bearer Token |

请求体统一为：

```json
{
  "currentPassword": "change_me",
  "newPassword": "new_change_me"
}
```

两个密码字段长度均为 8～128 位，请求体不接受其他字段。

## 2. 安全规则

1. 必须先通过 Access Token 和数据库 Session 校验当前身份。
2. 必须使用 Argon2 校验当前密码，不接受密码 Hash 作为输入。
3. 新密码不能与当前密码相同。
4. 新密码使用 Argon2 重新生成 Hash，数据库不保存明文密码。
5. 修改成功后保留发起修改的当前 Session，撤销同一身份域内的其他 Session。
6. 租户密码只修改当前 `TenantMembership.passwordHash`，不影响同一 User 的其他租户成员身份。
7. 平台密码只修改当前 `PlatformAdministrator.passwordHash`，不影响租户成员凭证。

## 3. 错误语义

| HTTP | 错误码 | 含义 |
| --- | --- | --- |
| `400` | `AUTH_NEW_PASSWORD_SAME_AS_CURRENT` | 新密码与当前密码相同 |
| `401` | `AUTH_CURRENT_PASSWORD_INVALID` | 当前密码错误 |
| `401` | `AUTH_UNAUTHORIZED` | 租户登录状态无效 |
| `401` | `PLATFORM_AUTH_UNAUTHORIZED` | 平台登录状态无效 |

## 4. 审计

- 租户修改成功：`AUTH_PASSWORD_CHANGED`；当前密码错误：`AUTH_PASSWORD_CHANGE_FAILED`。
- 平台修改成功：`PLATFORM_PASSWORD_CHANGED`；当前密码错误：`PLATFORM_PASSWORD_CHANGE_FAILED`。
- 审计元数据只记录撤销的其他 Session 数量和失败原因，不记录密码、密码 Hash 或请求体。
- 租户事件写入 `audit_logs`，平台事件写入 `platform_audit_logs`，两类审计保持隔离。

## 5. 与管理员重置的区别

- 本功能是本人已知当前密码时的主动修改。
- 租户管理员重置其他成员凭证仍使用 `/tenants/current/members/{membershipId}/credential-reset`，该流程清空旧密码并签发一次性激活令牌。
- 忘记密码、自助找回密码和平台管理员之间的密码重置仍暂缓。
