# 钉钉组织架构与人员同步 API

公开契约版本：`0.24.0`。完整定义以 `packages/contracts/openapi/openapi.yaml` 为准，修改契约后必须重新生成 `packages/api-client`。

## 接口清单

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/dingtalk/integration` | `dingtalk.integration.read` | 查询当前租户绑定 |
| `POST` | `/dingtalk/integration` | `dingtalk.integration.manage` | 创建绑定并验证凭证 |
| `PATCH` | `/dingtalk/integration` | `dingtalk.integration.manage` | 修改 AppKey、AppSecret 或启停状态，必须传 `version` |
| `POST` | `/dingtalk/integration/verify` | `dingtalk.integration.manage` | 重新验证凭证 |
| `POST` | `/dingtalk/organization/sync` | `dingtalk.organization.sync` | 全量同步部门和人员 |
| `GET` | `/dingtalk/organization/departments` | `dingtalk.organization.read` | 查询部门镜像 |
| `GET` | `/dingtalk/organization/users` | `dingtalk.organization.read` | 查询人员镜像 |
| GET | /dingtalk/sync-jobs | dingtalk.integration.read | 查询同步任务 |
| POST | /dingtalk/organization/mapping/preview | dingtalk.organization.mapping.preview | 预览部门和成员映射 |
| POST | /dingtalk/organization/mapping/apply | dingtalk.organization.mapping.manage | 应用映射并创建待激活成员 |

所有路径在 `/api/v1` 下，成功响应使用统一 `{ success: true, data, requestId }` 包装，失败响应使用统一错误结构。列表接口支持 `limit` 和 `cursor`，部门/人员列表额外支持 `includeDeleted`。

## 创建绑定示例

```json
{
  corpId: dingxxxxxxxx,
  appKey: dingxxxxxxxx,
  appSecret: 钉钉应用密钥
}
```

成功响应的 `data` 只包含 `id`、`tenantId`、`corpId`、`appKey`、状态、时间和版本，不包含 `appSecret` 或 `appSecretCiphertext`。

## 更新绑定示例

```json
{
  appKey: dingxxxxxxxx,
  status: ACTIVE,
  version: 1
}
```

更新 AppSecret 时一并传 `appSecret`。除停用操作外，服务端会先验证新凭证；版本不一致返回 `409 RESOURCE_VERSION_CONFLICT`。

## 同步结果

同步成功返回 `DingTalkSyncJob`，包含 `status=SUCCEEDED`、`departmentCount`、`userCount`、`startedAt` 和 `completedAt`。同步失败仍会写入失败任务，并记录 `errorCode`、`errorMessage`，同时将集成状态置为 `ERROR`。

## 重要边界

- 同步只保存钉钉外部镜像，不创建 CEES 登录账号；组织映射应用时可以按管理员确认结果创建待激活的 CEES 登录账号。
- 不自动修改 CEES 账号、密码、角色、RBAC 权限和项目成员关系。
- 部门和人员镜像中的 `departmentId`、`membershipId` 通过组织映射接口填充；自动匹配遵循同父级同名和姓名/部门规则，多候选必须由租户管理员确认。
- 当前版本不提供考勤、请假、审批、钉钉文档、聊天消息、日程和 AI 派发接口。

## 组织映射

### 预览

```http
POST /api/v1/dingtalk/organization/mapping/preview
```

```json
{
  "activationExpiresInDays": 7,
  "createMissingDepartments": true,
  "createMissingMembers": true
}
```

预览不会写入正式部门、成员或映射，返回 `MATCH_EXISTING`、`CREATE` 和 `CONFLICT` 三类结果。部门按同父级同名唯一规则匹配，人员优先按已有钉钉映射，其次按同名且部门一致匹配。

### 应用

```http
POST /api/v1/dingtalk/organization/mapping/apply
```

重名人员由租户管理员在 `userResolutions` 中选择已有成员：

```json
{
  "createMissingDepartments": true,
  "createMissingMembers": true,
  "activationExpiresInDays": 7,
  "userResolutions": [
    {
      "dingtalkUserId": "钉钉用户镜像记录UUID",
      "action": "BIND_EXISTING",
      "membershipId": "CEES租户成员UUID"
    }
  ]
}
```

找不到已有成员时，服务端按姓名生成小写拼音账号；租户内账号冲突时依次使用 `zhangsan2`、`zhangsan3` 等后缀。新成员状态为 `PENDING_ACTIVATION`，密码为空，响应中的 `credentials` 返回一次性激活令牌。管理员应立即保存或由前端生成 Excel，服务端不保存明文令牌。

用户使用 `POST /api/v1/auth/activate` 设置自己的密码，之后使用普通租户登录接口登录。重复应用已经完成映射的钉钉人员不会重复创建账号或激活凭证。

应用接口在事务中执行，并写入审计事件；遇到并发修改时返回 `409`，需要重新预览。
