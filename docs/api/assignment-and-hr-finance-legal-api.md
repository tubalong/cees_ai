# 分配策略与人财法 API（C 契约草案）

> 状态：OpenAPI 契约已写入 `packages/contracts/openapi/openapi.yaml`，服务端尚未实现
> Owner：C
> 关联：[通用任务 tasks.scope 方案](../architecture/task-scope-proposal.md)、[人财法数据契约](../architecture/hr-finance-legal-data-contract.md)

## 1. 已写入契约的路径

### 分配策略

```text
GET    /api/v1/assignment/policies
POST   /api/v1/assignment/policies
GET    /api/v1/assignment/policies/{policyId}
PATCH  /api/v1/assignment/policies/{policyId}
DELETE /api/v1/assignment/policies/{policyId}?version={version}
POST   /api/v1/assignment/policies/resolve
```

- `CreateAssignmentPolicyRequest` 支持租户默认策略（`level = TENANT`）和项目覆盖策略（`level = PROJECT`）。
- `resolve` 返回候选成员、请假跳过成员、兜底模式与来源追溯，不写入正式分配结果。

### HR 假勤

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
```

- 员工档案以 `membershipId` 为标识，避免复制成员账号状态。
- 请假审批通过统一 `review` 接口完成，`decision = APPROVE | REJECT`。
- 当前契约未包含提交、取消、撤销的独立接口，服务端实现阶段可在此基础上补兼容操作。

### Finance 报销

```text
GET    /api/v1/finance/expense-categories
POST   /api/v1/finance/expense-categories
GET    /api/v1/finance/expense-reports
POST   /api/v1/finance/expense-reports
POST   /api/v1/finance/expense-reports/{reportId}/review
```

- 报销单包含明细数组，`totalAmount` 由服务端与明细求和校验。
- 审批通过统一 `review` 接口，`decision = APPROVE | REJECT`。

### Legal 合同台账

```text
GET    /api/v1/legal/contracts
POST   /api/v1/legal/contracts
GET    /api/v1/legal/contracts/{contractId}
PATCH  /api/v1/legal/contracts/{contractId}
DELETE /api/v1/legal/contracts/{contractId}?version={version}
```

### 老板经营概况

```text
GET    /api/v1/boss-overview
```

### 租户联网检索策略

```text
GET    /api/v1/tenants/current/search-policy
PATCH  /api/v1/tenants/current/search-policy
```

## 2. 权限码

- `assignment.policy.read`
- `assignment.policy.manage`
- `hr.profile.read`
- `hr.profile.manage`
- `hr.leave.read`
- `hr.leave.request`
- `hr.leave.approve`
- `hr.leave.manage_all`
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

## 3. 契约原则

- 先改 `packages/contracts/openapi/openapi.yaml`，再运行 `contracts:lint`、`contracts:gen`、`contracts:check`。
- 所有列表返回 `items` + `nextCursor`。
- 所有写操作返回稳定资源与 `version`，并纳入审计。
- 人财法数据范围由服务端 `DataScopeResolverService` 统一解析。
