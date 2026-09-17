# 分配策略与人财法 API

> 状态：AssignmentPolicy 与 HR 已实现；Finance/Legal 与 tasks.scope 仍为契约草案
> Owner：C
> 关联：[通用任务 tasks.scope 方案](../architecture/task-scope-proposal.md)、[人财法数据契约](../architecture/hr-finance-legal-data-contract.md)

## 1. 分配策略（已实现）

```text
GET    /api/v1/assignment/policies
POST   /api/v1/assignment/policies
GET    /api/v1/assignment/policies/{policyId}
PATCH  /api/v1/assignment/policies/{policyId}
DELETE /api/v1/assignment/policies/{policyId}?version={version}
POST   /api/v1/assignment/policies/resolve
```

### 1.1 列表与详情

- `GET /assignment/policies` 支持 `domain`、`projectId`、`limit`、`cursor`。
- 返回 `items` + `nextCursor`，列表仅包含当前租户未删除策略。
- `GET /assignment/policies/{policyId}` 返回策略详情及当前 `version`。

### 1.2 创建与修改

- `level = TENANT` 创建租户默认策略，不能传 `projectId`。
- `level = PROJECT` 创建项目覆盖策略，必须传当前租户有效项目的 `projectId`。
- `candidatePool` 支持 `membershipIds`、`departmentIds`、`projectIds`，服务端去重。
- 同租户、同 `domain`、同 `level`、同 `projectId` 只允许一条活跃策略。
- `skipOnLeave` 当前只保存策略规则，实际请假过滤在 P2 接入。
- `fallbackMode` 为 `NONE`、`PROJECT_MEMBERS` 或 `TENANT_MEMBERS`。
- `enabled` 默认为 `true`。
- 修改接口支持局部更新，必须携带 `version` 做乐观锁。

### 1.3 删除

- `DELETE /assignment/policies/{policyId}?version={version}` 为软删除。
- 删除后同领域、同层级、同项目可重建策略。

### 1.4 解析预览

- `POST /assignment/policies/resolve` 只做候选池解析预览，不创建任务或写正式分配结果。
- 请求体：`domain`、可选 `projectId`、可选 `context.sourceType/sourceId`。
- 返回：`matchedPolicyId`、`domain`、`level`、`candidates`、`skippedOnLeave`、`fallbackMode`、`sourceTrace`、`resolvedAt`。
- 解析顺序：项目覆盖策略优先，其次租户默认策略。
- 候选池为空时按策略 `fallbackMode` 兜底。
- 解析成功写 `ASSIGNMENT_POLICY_RESOLVED` 审计事件。

### 1.5 权限与审计

- `assignment.policy.read`：查询与解析预览。
- `assignment.policy.manage`：创建、修改、删除。
- 审计事件：`ASSIGNMENT_POLICY_CREATED`、`ASSIGNMENT_POLICY_UPDATED`、`ASSIGNMENT_POLICY_DELETED`、`ASSIGNMENT_POLICY_RESOLVED`。

## 2. HR（已实现）

```text
GET    /api/v1/hr/profiles
POST   /api/v1/hr/profiles
GET    /api/v1/hr/profiles/{membershipId}
PATCH  /api/v1/hr/profiles/{membershipId}
GET    /api/v1/hr/leave-types
POST   /api/v1/hr/leave-types
GET    /api/v1/hr/leave-balances
GET    /api/v1/hr/leave-requests
POST   /api/v1/hr/leave-requests
POST   /api/v1/hr/leave-requests/{leaveRequestId}/review
POST   /api/v1/hr/leave-requests/{leaveRequestId}/cancel
POST   /api/v1/hr/leave-requests/{leaveRequestId}/withdraw
GET    /api/v1/hr/attendance-records
POST   /api/v1/hr/attendance-records
POST   /api/v1/hr/attendance-records/import
PATCH  /api/v1/hr/attendance-records/{attendanceRecordId}
POST   /api/v1/hr/attendance-records/{attendanceRecordId}/review
GET    /api/v1/hr/overtime-requests
POST   /api/v1/hr/overtime-requests
POST   /api/v1/hr/overtime-requests/{overtimeRequestId}/review
GET    /api/v1/hr/employee-changes
POST   /api/v1/hr/employee-changes
POST   /api/v1/hr/employee-changes/{employeeChangeId}/review
GET    /api/v1/hr/reports/headcount
GET    /api/v1/hr/reports/leave-summary
GET    /api/v1/hr/reports/attendance-summary
GET    /api/v1/hr/reports/overtime-summary
```

- 员工档案以 `membershipId` 为标识，避免复制成员账号状态。
- 请假审批通过统一 `review` 接口完成，`decision = APPROVE | REJECT`。
- 请假提交冻结余额，审批、撤回和取消在同一事务中更新余额和申请状态。
- 考勤导入单批最多 500 条，返回逐条失败位置与原因，不因单条失败回滚整批。
- 人事异动审批通过后同步员工档案；目标部门变化同步 `TenantMembership.departmentId`。
- 全部 HR 资源按租户隔离并接入 `DataScopeResolverService`、乐观锁和审计。

## 3. Finance 报销（契约草案）

```text
GET    /api/v1/finance/expense-categories
POST   /api/v1/finance/expense-categories
GET    /api/v1/finance/expense-reports
POST   /api/v1/finance/expense-reports
POST   /api/v1/finance/expense-reports/{reportId}/review
```

- 报销单包含明细数组，`totalAmount` 由服务端与明细求和校验。
- 审批通过统一 `review` 接口，`decision = APPROVE | REJECT`。

## 4. Legal 合同台账（契约草案）

```text
GET    /api/v1/legal/contracts
POST   /api/v1/legal/contracts
GET    /api/v1/legal/contracts/{contractId}
PATCH  /api/v1/legal/contracts/{contractId}
DELETE /api/v1/legal/contracts/{contractId}?version={version}
```

## 5. 老板经营概况与租户联网检索策略（契约草案）

```text
GET    /api/v1/boss-overview
GET    /api/v1/tenants/current/search-policy
PATCH  /api/v1/tenants/current/search-policy
```

## 6. 权限码

- `assignment.policy.read`
- `assignment.policy.manage`
- `hr.profile.read`
- `hr.profile.manage`
- `hr.leave.read`
- `hr.leave.request`
- `hr.leave.approve`
- `hr.leave.manage_all`
- `hr.attendance.read` / `hr.attendance.manage` / `hr.attendance.approve`
- `hr.overtime.read` / `hr.overtime.request` / `hr.overtime.approve`
- `hr.employee_change.read` / `hr.employee_change.manage` / `hr.employee_change.approve`
- `hr.report.read`
- `finance.expense.read`
- `finance.expense.request`
- `finance.expense.approve`
- `finance.expense.manage_all`
- `legal.contract.read`
- `legal.contract.create`
- `legal.contract.update`
- `legal.contract.delete`
- `legal.contract.manage_all`
- `dashboard.read`：老板经营概况读取
- `tenant.read` / `tenant.update`：租户联网检索策略

## 7. 契约原则

- 先改 `packages/contracts/openapi/openapi.yaml`，再运行 `contracts:lint`、`contracts:gen`、`contracts:check`。
- 所有列表返回 `items` + `nextCursor`。
- 所有写操作返回稳定资源与 `version`，并纳入审计。
- 人财法数据范围由服务端 `DataScopeResolverService` 统一解析。
