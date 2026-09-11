# 组织与部门管理

## 角色语义

- 租户管理员是当前企业的企业管理员，由系统角色 `tenant_admin` 和实时权限共同决定能力。
- 企业管理员邀请的成员只能加入当前登录租户；客户端和邀请请求均不接收任意 `tenantId`。
- 当前租户边界完全来自 Access Token 中的可信租户和 Membership 上下文，服务端仍是最终权限事实源。

## 已接入接口

| 接口 | 客户端能力 | 权限 |
| --- | --- | --- |
| `GET /tenants/current/departments` | 查询并展示部门树，可按状态过滤 | `department.read` |
| `POST /tenants/current/departments` | 创建根部门或子部门 | `department.create` |
| `GET /tenants/current/departments/{departmentId}` | 查询部门详情 | `department.read` |
| `PATCH /tenants/current/departments/{departmentId}` | 修改名称、移动父级、启用或停用 | `department.update` |
| `DELETE /tenants/current/departments/{departmentId}?version=` | 删除空部门 | `department.delete` |
| `GET /tenants/current/departments/{departmentId}/members` | 查询选中部门的成员 | `department.read`、`member.read` |
| `PUT /tenants/current/members/{membershipId}/department` | 调整成员所属部门 | `department.member.assign` |

## 交互规则

- 组织树根节点固定为当前登录企业，点击根节点展示全部可见成员。
- 点击部门节点时通过部门成员接口刷新中间成员列表。
- 新建部门提交 `name` 和可选 `parentId`；创建子部门时父级来自当前节点。
- 编辑部门提交可变字段和服务端返回的当前 `version`，支持移动到企业根节点及启停。
- 删除部门在 URL 查询参数中提交当前 `version`；存在子部门或成员时由服务端拒绝。
- 成员调岗提交目标 `departmentId` 和当前 Membership `version`；成功后刷新全部成员、部门成员和部门树。
- 所有操作按钮根据 `/auth/me` 返回的实时权限显示或禁用，前端权限控制不替代服务端校验。
- `409` 乐观锁冲突直接展示服务端错误，用户刷新后再操作，客户端不自动覆盖新版本。

## 邀请边界

- “邀请同事”入口位于组织与部门页面，调用当前租户的邀请、角色和账号建议接口。
- 邀请窗口明确展示当前企业标识，无法切换或提交其他租户。
- 一次性激活令牌仅在创建响应后展示，不写入本地持久化存储。