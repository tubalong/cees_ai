# 钉钉组织架构与人员同步 API

公开契约版本：`0.34.0`。完整定义以 `packages/contracts/openapi/openapi.yaml` 为准，修改契约后必须重新生成 `packages/api-client`。

本 API 同时支持企业应用凭证 `SELF_MANAGED_APP/FULL_SCOPE` 和桌面端 DWS/MCP 快照 `DWS_MCP/VISIBLE_SCOPE`。DWS/MCP 导入不检查操作者是否为钉钉管理员，但正式提交快照、预览映射和应用映射均要求操作者是当前 CEES 租户管理员。

## 接口清单

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/dingtalk/integration` | `dingtalk.integration.read` | 查询当前租户绑定 |
| `POST` | `/dingtalk/integration` | `dingtalk.integration.manage` | 创建绑定并验证凭证 |
| `PATCH` | `/dingtalk/integration` | `dingtalk.integration.manage` | 修改 AppKey、AppSecret 或启停状态，必须传 `version` |
| `POST` | `/dingtalk/integration/verify` | `dingtalk.integration.manage` | 重新验证凭证 |
| `POST` | `/dingtalk/organization/sync` | `dingtalk.organization.sync` | 全量同步部门和人员 |
| `POST` | `/dingtalk/organization/snapshot` | `dingtalk.organization.sync` + `tenant_admin` | 导入 DWS/MCP 当前授权账号可见组织快照 |
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
- 当前版本不提供考勤、请假、审批、钉钉文档、聊天消息、日程和 AI 派发接口。DWS/MCP 连接器整体架构见 [钉钉 DWS/MCP 连接器](../product/dingtalk-mcp-connector.md)。

## DWS/MCP 可见组织快照

```http
POST /api/v1/dingtalk/organization/snapshot
```

请求体包含当前授权账号的 `corpId`、`externalUserId`、`profile`、能力列表、部门和人员快照。API 将其记录为 `source=DWS_MCP`、`scope=VISIBLE_SCOPE`，只对返回的部门和人员执行幂等 upsert；没有出现在本次快照中的既有镜像不会被标记删除或离职。

接口只接受当前 CEES 租户管理员请求。服务端不检查钉钉 `admin/boss` 字段，也不会让 MCP 直接写入 CEES 正式部门或成员；正式写入仍通过映射预览和映射应用接口完成，并记录授权用户、来源 profile 和数量审计。

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

预览不会写入正式部门、成员或映射，返回 `MATCH_EXISTING`、`CREATE` 和 `CONFLICT` 三类结果。部门按同父级同名唯一规则匹配，人员优先按已有钉钉映射，其次按同名且部门一致匹配。部门按父子关系逐级分析：父部门为 `CREATE` 时，子部门将该父部门视为计划可用父级并继续判断，应用时按父到子的顺序创建；不会因为父部门尚未落库而返回 `PARENT_MAPPING_MISSING`。只有父部门冲突未解决或同步镜像缺少父级时，才会返回 `PARENT_MAPPING_MISSING`。

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
  "roleAssignments": [
    {
      "roleId": "普通员工角色UUID",
      "dingtalkUserIds": [
        "钉钉用户镜像记录UUID-张三",
        "钉钉用户镜像记录UUID-王五"
      ]
    },
    {
      "roleId": "技术人员角色UUID",
      "dingtalkUserIds": [
        "钉钉用户镜像记录UUID-李四"
      ]
    }
  ],
  "userResolutions": [
    {
      "dingtalkUserId": "钉钉用户镜像记录UUID",
      "action": "BIND_EXISTING",
      "membershipId": "CEES租户成员UUID"
    }
  ]
}
```

`roleAssignments` 是应用映射时的批量角色分配：一个角色可以分配给多人，一个人也可以出现在多个角色的 `dingtalkUserIds` 中。角色必须是当前租户未删除的角色，`tenant_admin` 不允许通过该接口分配。角色不会自动创建，租户管理员应先在角色管理中创建并配置角色。

当本次会创建新成员时，每个新成员至少需要一个角色；缺少角色会返回 `DINGTALK_MAPPING_ROLE_REQUIRED`，不会创建该批次的新成员。已匹配的已有成员默认保留已有角色；如果在 `roleAssignments` 中再次指定，服务端追加角色而不是覆盖原有角色。部门映射和已有成员绑定不因未分配角色而阻塞。

找不到已有成员时，服务端按姓名生成小写拼音账号；租户内账号冲突时依次使用 `zhangsan2`、`zhangsan3` 等后缀。新成员状态为 `PENDING_ACTIVATION`，密码为空，响应中的 `credentials` 返回一次性激活令牌以及实际写入的 `roleIds`、`roleCodes`。管理员应立即保存或由前端生成 Excel，服务端不保存明文令牌。

用户使用 `POST /api/v1/auth/activate` 设置自己的密码，之后使用普通租户登录接口登录。重复应用已经完成映射的钉钉人员不会重复创建账号或激活凭证。

应用接口在事务中执行，并写入审计事件；遇到并发修改时返回 `409`，需要重新预览。
