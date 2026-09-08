# 组织部门管理

> 状态：已实现  
> 最后同步：2026-09-08  
> 契约版本：`0.8.0`

## 1. 业务边界

- `Tenant` 是企业或组织的根节点，不再创建重复的 Organization 数据表。
- 平台超级管理员负责租户生命周期和首位租户管理员，不维护租户内部部门。
- 租户内部部门由拥有部门权限的成员维护；`tenant_admin` 默认拥有完整部门权限，也可通过自定义角色委派。
- 一个 `TenantMembership` 当前只能归属一个主要部门，`department_id = null` 表示暂未分配。
- 部门操作全部由 `apps/api` 执行并写入租户审计，客户端和 AI 服务不能直接修改正式数据。

## 2. 数据模型

`departments` 使用 `parent_id` 自关联形成树，新增字段如下：

| 字段 | 说明 |
| --- | --- |
| `normalized_name` | 规范化部门名称，用于同级唯一性校验 |
| `description` | 部门说明，可为空 |
| `sort_order` | 同级排序值，越小越靠前 |
| `status` | `ACTIVE` 或 `DISABLED` |

约束：

- 根部门名称在租户内唯一；非根部门名称在同一父部门下唯一。
- 唯一性只约束未软删除部门，删除后可以重新使用原名称。
- 最大部门深度为 10；创建和移动时禁止形成父子循环。
- 删除使用软删除；存在未删除子部门或未删除成员时拒绝删除。
- 修改、移动、删除和成员调部门使用 `version` 乐观锁。
- 只能向 `ACTIVE` 部门分配成员；成员可以调整为未分配部门。

数据库迁移为 `apps/api/prisma/migrations/0003_organization_departments_and_database_comments/migration.sql`。该迁移同时为当前 39 张业务表和全部业务字段补充 PostgreSQL 表、字段注释；后续新增表和字段必须在对应迁移中同时添加 `COMMENT ON TABLE` 和 `COMMENT ON COLUMN`。

## 3. 权限

| 权限 | 用途 |
| --- | --- |
| `department.read` | 查看部门树、部门详情和部门成员 |
| `department.create` | 创建部门 |
| `department.update` | 修改、移动、启停部门 |
| `department.delete` | 删除空部门 |
| `department.member.assign` | 调整成员所属部门 |

原成员修改接口仍可修改 `departmentId`，但服务层会额外校验 `department.member.assign`，防止只持有 `member.update` 时绕过部门授权。

## 4. API

| 方法与路径 | 权限 | 说明 |
| --- | --- | --- |
| `GET /api/v1/tenants/current/departments` | `department.read` | 查询部门树，可按状态筛选 |
| `POST /api/v1/tenants/current/departments` | `department.create` | 创建部门 |
| `GET /api/v1/tenants/current/departments/{departmentId}` | `department.read` | 查询部门详情 |
| `PATCH /api/v1/tenants/current/departments/{departmentId}` | `department.update` | 修改或移动部门 |
| `DELETE /api/v1/tenants/current/departments/{departmentId}?version=1` | `department.delete` | 删除空部门 |
| `GET /api/v1/tenants/current/departments/{departmentId}/members` | `department.read`、`member.read` | 分页查询部门成员 |
| `PUT /api/v1/tenants/current/members/{membershipId}/department` | `department.member.assign` | 调整成员部门 |

公开契约事实源为 `packages/contracts/openapi/openapi.yaml`，生成的 TypeScript 客户端位于 `packages/api-client/src`。

## 5. 审计

部门业务写入以下动作：

```text
DEPARTMENT_CREATED
DEPARTMENT_UPDATED
DEPARTMENT_MOVED
DEPARTMENT_DELETED
MEMBER_DEPARTMENT_CHANGED
```

审计记录包含租户、操作者 User、操作者 Membership、请求 ID、资源 ID 和变更前后元数据。

## 6. 暂缓范围

- 一个成员同时属于多个部门；
- 部门负责人字段及其独立授权语义；
- 部门整棵子树批量移动、批量删除和批量成员调动；
- 部门历史版本恢复；
- 部门数据范围对项目、任务等后续业务资源的自动继承。
