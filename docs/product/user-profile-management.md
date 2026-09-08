# 用户个人资料管理

> 状态：已实现，公开契约版本 `0.9.0`
>
> 适用范围：租户成员维护自己在当前租户内的展示资料

## 1. 业务边界

- 个人资料属于当前 `TenantMembership`，修改只影响当前登录租户，不影响用户在其他租户中的展示信息。
- 本期允许成员自行修改 `displayName`。
- `account` 由租户管理员管理，个人资料接口只读返回，不允许成员自行修改。
- 邮箱绑定、手机绑定、头像上传和密码修改不属于本次范围。
- 接口依赖有效租户 Access Token，不要求额外 RBAC 权限，任何有效成员都可以维护自己的资料。

## 2. 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/v1/users/me/profile` | 查询当前租户内的个人资料 |
| `PATCH` | `/api/v1/users/me/profile` | 修改当前租户内的展示名 |

### 2.1 修改请求

```json
{
  "displayName": "张三",
  "version": 1
}
```

- `displayName` 去除首尾空白后保存，长度为 1～120 个字符。
- `version` 对应 `tenant_memberships.version`，用于乐观锁；版本不一致时返回 `409 USER_PROFILE_VERSION_CONFLICT`。
- 请求体不接受契约之外的字段，因此不能通过该接口修改账号、成员状态、部门或角色。

## 3. 返回模型

个人资料返回以下信息：

- `userId`：全局用户 ID；
- `membershipId`：当前租户成员 ID；
- `tenantId`：当前租户 ID；
- `account`：当前租户登录账号，只读；
- `displayName`：当前租户展示名；
- `department`：当前部门 ID 和名称，无部门时为 `null`；
- `version`：当前成员版本；
- `updatedAt`：资料最后更新时间。

## 4. 数据与审计

- 本功能复用现有 `tenant_memberships.display_name`、`version`、`updated_at` 和 `updated_by` 字段，不新增数据库表或字段，因此不需要 Prisma migration。
- 修改成功后写入 `USER_PROFILE_UPDATED` 审计事件，资源类型为 `TENANT_MEMBERSHIP`，记录修改前后的展示名。
- 展示名没有变化时直接返回当前资料，不增加版本，也不重复写审计事件。

## 5. 暂缓能力

- 用户头像依赖腾讯云 COS 文件上传能力，待文件模块落地后单独设计。
- 邮箱、手机需要验证、唯一性、换绑和找回流程，暂不开放。
- 密码修改属于身份凭证管理，应独立设计旧密码校验、会话撤销和安全审计。
