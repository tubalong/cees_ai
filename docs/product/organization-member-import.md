# 组织架构与成员批量导入

> 状态：已实现
> 最后同步：2026-09-09
> 契约版本：`0.12.0`

## 1. 目标与边界

- 租户管理员通过 Excel 一次导入部门和成员，避免逐个创建。
- Excel 只由桌面端或其他前端解析；`apps/api` 不接收和解析 Excel 文件。
- 前端负责字段映射、拼音账号建议、预览和激活凭证 Excel 导出。
- API 负责租户边界、层级、账号、角色、事务、激活令牌和审计，是正式数据的唯一写入方。
- 第一版只创建新成员，不更新或覆盖已有成员。
- 第一版禁止批量分配 `tenant_admin`，租户管理员必须通过正式管理员流程单独设置。

## 2. Excel 模板

### 2.1 部门 Sheet

| 部门路径 | 排序 | 部门说明 |
| --- | ---: | --- |
| 总部 | 0 | 公司总部 |
| 总部/研发部 | 10 | 产品研发部门 |
| 总部/研发部/后端组 | 10 | 后端研发小组 |

规则：

- `/` 表示部门层级，单级部门名称不能包含 `/`。
- 路径不能以 `/` 开头或结尾，不能出现连续的 `//`。
- 完整路径在导入文件中唯一，层级最多 10 级。
- 管理员不填写部门编码；前端按行和路径生成 `clientRef`、`parentClientRef`。

### 2.2 人员 Sheet

| 姓名 | 登录账号（可选） | 部门路径 |
| --- | --- | --- |
| 张三 |  | 总部/研发部/后端组 |
| 李四 | lisi | 总部/研发部 |

规则：

- 登录账号为空时，前端根据姓名生成拼音建议。
- 同名、同拼音或已有账号冲突由租户管理员在预览页裁定。
- 最终提交 API 的账号不能为空，长度为 3～32 位，只允许英文字母和数字。
- 账号按小写在租户内唯一，平台身份键为 `tenantCode + normalizedAccount`。
- 角色不写入 Excel，前端通过 `GET /api/v1/roles` 显示可选角色名称。

## 3. 请求结构

```json
{
  defaultRoleIds: [70000000-0000-0000-0000-000000000001],
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
    }
  ],
  members: [
    {
      clientRef: member-row-2,
      account: zhangsan,
      displayName: 张三,
      departmentClientRef: department-row-3
    },
    {
      clientRef: member-row-3,
      account: lisi,
      displayName: 李四,
      departmentClientRef: department-row-3,
      roleIds: [70000000-0000-0000-0000-000000000002]
    }
  ],
  activationExpiresInDays: 7
}
```

- `clientRef` 只在本次请求内关联数据，不写入数据库。
- 成员存在 `roleIds` 时使用专属角色，否则使用 `defaultRoleIds`。
- `defaultRoleIds` 至少包含一个角色。
- 激活有效期默认为 7 天，可设置为 1～30 天。

## 4. API 流程

| 方法与路径 | 说明 | 权限 |
| --- | --- | --- |
| `POST /api/v1/tenants/current/organization-imports/validate` | 完整校验和预览，不写正式数据 | `department.create`、`member.invite`、`role.assign` |
| `POST /api/v1/tenants/current/organization-imports/confirm` | 重新校验并事务导入 | `department.create`、`member.invite`、`role.assign` |

推荐前端流程：

1. 读取 Excel 并构建标准 JSON。
2. 调用 `validate`，按照 `issues` 定位原 Excel 行。
3. 展示部门 `CREATE/REUSE` 预览、最终账号和有效角色。
4. 管理员确认后，将同一份 JSON 提交 `confirm`。
5. 收到响应后立即导出成员激活凭证 Excel。

`validate` 的业务错误使用 `200` 响应和 `valid=false` 表达；DTO 结构、字段格式、字段长度或数组数量不合法时返回 HTTP `400`。

## 5. 部门处理

- API 根据规范化后的同级部门名称匹配已有部门。
- 完整路径对应的已有部门为 `ACTIVE` 时直接复用，不修改名称、说明或排序。
- 匹配到 `DISABLED` 部门时返回问题，不能确认导入。
- 新部门按父部门优先顺序创建。
- 导入文件内重复 `clientRef`、同级重名、父引用缺失、循环或超过 10 级都会阻止导入。

## 6. 成员、角色与激活

确认导入会在同一个可串行化事务中创建：

```text
User
TenantMembership(status=PENDING_ACTIVATION, passwordHash=null)
MembershipRole
TenantInvitation(targetMembershipId=membership.id)
TenantInvitationRole
```

- 已存在租户账号或存在未过期邀请时拒绝导入。
- 角色必须属于当前租户且未删除。
- 默认角色或成员专属角色包含 `tenant_admin` 时拒绝确认。
- 每名成员使用独立随机激活令牌；数据库只保存 SHA-256 Hash。
- 成员调用 `POST /api/v1/auth/activate` 设置初始密码后转为 `ACTIVE`。
- 角色在确认导入事务中提前分配，激活接口不会再次创建角色关系。

## 7. 确认响应与 Excel 导出

确认接口返回部门映射和成员激活凭证：

```json
{
  members: [
    {
      clientRef: member-row-2,
      membershipId: 50000000-0000-0000-0000-000000000001,
      displayName: 张三,
      account: zhangsan,
      departmentId: 60000000-0000-0000-0000-000000000001,
      departmentPath: 总部/研发部,
      tenantCode: cees,
      activationToken: 仅返回一次的明文令牌,
      activationExpiresAt: 2026-09-16T00:00:00.000Z
    }
  ]
}
```

前端导出的凭证 Excel 建议包含：

```text
姓名 | 部门 | 租户编码 | 登录账号 | 激活码 | 过期时间
```

明文令牌只返回一次，不写日志和审计。响应丢失后无法恢复原令牌，应使用现有成员凭证重置接口重新签发。

## 8. 限制与审计

| 项目 | 限制 |
| --- | ---: |
| 部门数量 | 每批最多 200 |
| 成员数量 | 每批最多 500 |
| JSON 请求体 | 最大 2 MiB |
| 部门深度 | 最大 10 级 |
| 激活有效期 | 1～30 天，默认 7 天 |

成功确认后写入一条 `ORGANIZATION_MEMBERS_IMPORTED` 租户审计，记录创建和复用部门数量、成员数量及统一过期时间，不记录明文激活令牌。

该功能复用已有表，不新增 Prisma 模型或迁移。
