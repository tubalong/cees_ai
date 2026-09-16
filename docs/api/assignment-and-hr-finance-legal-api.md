# 分配策略与人财法 API（设计草案）

> 状态：设计草案，尚未写入 OpenAPI
> Owner：C
> 当前版本：仅列出规划路径与权限码，未生成客户端。

## 1. 规划路径

以下为建议路径，最终以 `packages/contracts/openapi/openapi.yaml` 为准。

### 分配策略

```text
GET    /api/v1/assignment/policies
POST   /api/v1/assignment/policies
GET    /api/v1/assignment/policies/{policyId}
PATCH  /api/v1/assignment/policies/{policyId}
DELETE /api/v1/assignment/policies/{policyId}
POST   /api/v1/assignment/policies/resolve
```

### HR 假勤

```text
GET    /api/v1/hr/profiles
GET    /api/v1/hr/profiles/{membershipId}
GET    /api/v1/hr/leave-types
POST   /api/v1/hr/leave-types
GET    /api/v1/hr/leave-balances
GET    /api/v1/hr/leave-requests
POST   /api/v1/hr/leave-requests
POST   /api/v1/hr/leave-requests/{leaveRequestId}/submit
POST   /api/v1/hr/leave-requests/{leaveRequestId}/approve
POST   /api/v1/hr/leave-requests/{leaveRequestId}/reject
POST   /api/v1/hr/leave-requests/{leaveRequestId}/cancel
```

### Finance 报销

```text
GET    /api/v1/finance/expense-reports
POST   /api/v1/finance/expense-reports
GET    /api/v1/finance/expense-reports/{reportId}
POST   /api/v1/finance/expense-reports/{reportId}/submit
POST   /api/v1/finance/expense-reports/{reportId}/approve
POST   /api/v1/finance/expense-reports/{reportId}/reject
GET    /api/v1/finance/expense-categories
```

### Legal 合同台账

```text
GET    /api/v1/legal/contracts
POST   /api/v1/legal/contracts
GET    /api/v1/legal/contracts/{contractId}
PATCH  /api/v1/legal/contracts/{contractId}
DELETE /api/v1/legal/contracts/{contractId}
```

## 2. 规划权限码

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

## 3. 契约原则

- 先改 `packages/contracts/openapi/openapi.yaml`。
- 再重新生成 TS 客户端与必要端客户端。
- 所有写操作必须返回稳定结果，并纳入审计。
- 所有列表必须明确租户边界、数据范围和分页规则。
- 人财法只读聚合接口需优先满足 B 的老板经营概况。
