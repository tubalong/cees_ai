# C 后端主体 P0 复检与 RBAC 接入

> 状态：P0 复检完成
> Owner：C
> 关联：`apps/api/src/tenant/**`、`apps/api/src/organization/**`、`apps/api/src/rbac/**`

## 1. 复检范围

P0 只复检现有后端主体能力与本期新模块的衔接，不新增业务表或业务接口。

- 租户与成员：`apps/api/src/tenant/**`
- 部门与批量导入：`apps/api/src/organization/**`
- 角色、权限、数据范围：`apps/api/src/rbac/**`
- 审计：`apps/api/src/audit/**`

## 2. 边界结论

### 2.1 租户与成员

- 所有接口均经过 `JwtAuthGuard`、`TenantGuard`、`PermissionGuard`。
- `TenantContextInterceptor` 仅从已认证 Token 生成租户上下文，不接受客户端提交 `tenantId`。
- `TenantService` 的查询和写入均使用 `TenantContext.require().tenantId`。
- 当前租户成员列表、账号修改、凭证重置、移除成员均已有权限码。

结论：与本期 `assignment/hr/finance/legal` 的成员来源一致，无越权入口。

### 2.2 部门与批量导入

- 部门 CRUD、部门成员查询、成员部门调整均有独立权限码。
- 批量导入校验与确认要求 `department.create`、`member.invite`、`role.assign` 三项权限同时满足。
- 导入服务在事务内处理部门、成员、角色绑定和激活凭证，不绕过普通单资源权限。

结论：部门树与成员归属可作为 HR 假勤数据范围的部门来源，不复制状态机。

### 2.3 RBAC

- 权限目录由 `permission-catalog.ts` 统一维护，并已包含 C 模块权限码。
- `GET /permissions` 返回数据库权限目录，自定义角色可通过 `PUT /roles/{roleId}/permissions` 配置。
- 登录和每次 JWT 校验都会通过 `resolveMembershipAuthorization` 从数据库重新加载当前角色与权限。
- `DataScopeResolverService` 按角色 `dataScope` 解析 `TENANT`、`SELF`、`DEPARTMENT`、`DEPARTMENT_TREE`、`PROJECT`。
- `CUSTOM` 当前安全失败，返回 `DATA_SCOPE_CUSTOM_UNSUPPORTED`，不会静默降级为全租户。

结论：新模块权限已进入目录，可配置、可审计；CUSTOM 留到后续业务需要时再实现。

### 2.4 审计

- 角色创建、修改、删除、权限替换均写入 `ROLE_*` 审计事件。
- 审计元数据记录操作者成员、变更前后权限集合或角色快照。
- 新模块接口落地时必须沿用同一审计模式。

## 3. 新模块权限清单

| 模块 | 权限码 |
| --- | --- |
| 分配策略 | `assignment.policy.read`、`assignment.policy.manage` |
| 跨职能任务 | `task.cross_functional.*` |
| HR | `hr.profile.*`、`hr.leave.*` |
| Finance | `finance.expense.*` |
| Legal | `legal.contract.*` |

`tenant_admin` 已通过迁移获得上述权限；自定义角色默认不授予这些权限，需管理员显式配置。

## 4. P0 验收

- 租户、部门、批量导入、角色权限边界已复检，未发现本期新模块可绕过现有鉴权。
- 新模块权限可被自定义角色查询和授予。
- 权限替换和角色变更具备审计记录。
- 已增加 `permission-catalog` 与 `resolveMembershipAuthorization` 测试，覆盖权限唯一性、目录完整性和最小默认授权。
