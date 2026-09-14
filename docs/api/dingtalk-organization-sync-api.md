# 钉钉组织架构与人员同步 API

公开契约版本：`0.21.0`。完整定义以 `packages/contracts/openapi/openapi.yaml` 为准，修改契约后必须重新生成 `packages/api-client`。

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
| `GET` | `/dingtalk/sync-jobs` | `dingtalk.integration.read` | 查询同步任务 |

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

- 同步只保存钉钉外部镜像，不创建 CEES 登录账号。
- 不自动修改 CEES 账号、密码、角色、RBAC 权限和项目成员关系。
- 部门和人员镜像中的 `departmentId`、`membershipId` 当前为空，后续需管理员确认绑定。
- 当前版本不提供考勤、请假、审批、钉钉文档、聊天消息、日程和 AI 派发接口。
