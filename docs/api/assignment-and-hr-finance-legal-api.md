# 分配策略与人财法 API

> 状态：AssignmentPolicy、HR、Finance 与 Legal 已实现；tasks.scope 仍为契约草案
> Owner：C
> 关联：[通用任务 tasks.scope 方案](../architecture/task-scope-proposal.md)、[分配策略请假可用性过滤](../architecture/assignment-leave-availability.md)、[人财法数据契约](../architecture/hr-finance-legal-data-contract.md)、[Legal 合同台账设计](../architecture/legal-contract-ledger.md)

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
- `skipOnLeave` 开启后，解析请求可传 `availabilityWindow.startAt/endAt`；服务端只过滤与该窗口重叠的 `APPROVED` 请假，返回 `skippedOnLeave` 和 `leaveFilterApplied`。未提供时间窗口时保持候选人兼容返回，不静默按“今天”过滤。
- 候选池过滤后为空时，按 `fallbackMode` 扩展候选人，并对兜底候选人再次执行相同请假过滤；解析接口只返回候选结果，不创建或修改正式任务。
- `fallbackMode` 为 `NONE`、`PROJECT_MEMBERS` 或 `TENANT_MEMBERS`。
- `enabled` 默认为 `true`。
- 修改接口支持局部更新，必须携带 `version` 做乐观锁。

### 1.3 删除

- `DELETE /assignment/policies/{policyId}?version={version}` 为软删除。
- 删除后同领域、同层级、同项目可重建策略。

### 1.4 解析预览

- `POST /assignment/policies/resolve` 只做候选池解析预览，不创建任务或写正式分配结果。
- 请求体：`domain`、可选 `projectId`、可选 `context.sourceType/sourceId`。
- 返回：`matchedPolicyId`、`domain`、`level`、`candidates`、`skippedOnLeave`、`leaveFilterApplied`、`fallbackMode`、`sourceTrace`、`resolvedAt`。
- `availabilityWindow` 是通用可用时间窗口，不绑定 D 的 Task 表；开始时间必须早于结束时间，非法窗口返回 `400 ASSIGNMENT_AVAILABILITY_WINDOW_INVALID`。
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
- 员工档案敏感字段为手机号、邮箱、证件类型、证件号码、紧急联系人姓名和电话。`hr.profile.read` 返回脱敏值；完整读取需 `hr.profile.sensitive.read`，请求中出现任一敏感字段时需 `hr.profile.sensitive.manage`。
- 客户端不得把脱敏值作为修改请求回写；缺少敏感字段管理权限时应从请求体移除这些字段。
- 请假审批通过统一 `review` 接口完成，`decision = APPROVE | REJECT`。
- 请假提交冻结余额，审批、撤回和取消在同一事务中更新余额和申请状态。
- 创建请假申请时 `durationDays` 为可选的一致性校验值，服务端按申请时间与假期单位折算后以服务端结果为准；不一致返回 `400 HR_LEAVE_DURATION_MISMATCH`，折算结果低于 0.01 天返回 `400 HR_LEAVE_DURATION_TOO_SHORT`。
- 请假响应新增 `yearAllocations`，按租户本地年度给出额度占用明细；跨年度申请会同时占用多个年度余额。
- `GET /hr/leave-balances` 支持 `limit`、`cursor`，返回 `items` + `nextCursor`；`hr.leave.manage_all` 仅放宽当前租户内的请假数据范围。
- 同一成员待审批或已批准的时间段不可重叠，重叠返回 `409 HR_LEAVE_REQUEST_OVERLAP`；缺少对应年度余额记录返回 `409 HR_LEAVE_BALANCE_NOT_FOUND`。
- 创建加班申请时，`durationHours` 为客户端一致性校验值，正式时长由服务端按起止时间折算；不一致返回 `400 HR_OVERTIME_DURATION_MISMATCH`，时间重叠返回 `409 HR_OVERTIME_REQUEST_OVERLAP`。
- 请假、加班、考勤修正和人事异动的审批人不能是申请本人，命中返回 `403 HR_SELF_REVIEW_FORBIDDEN`。
- 员工档案 `PATCH` 不接受 `status = TERMINATED` 与 `leaveDate`，分别返回 `400 HR_PROFILE_TERMINATION_REQUIRES_CHANGE`、`400 HR_PROFILE_LEAVE_DATE_REQUIRES_CHANGE`；档案部门变更会同步租户成员部门并要求 `department.member.assign`。
- 考勤导入单批最多 500 条，返回逐条失败位置与原因，不因单条失败回滚整批。
- 人事异动审批通过后，生效日为当前租户日期或更早时立即进入 `EFFECTIVE`；未来生效时进入 `APPROVED`，由后台任务在租户本地生效日应用。目标部门变化同步 `TenantMembership.departmentId`。
- `RESIGNATION` 或 `TERMINATION` 审批通过时，同一事务停用对应租户成员、撤销全部未撤销会话并记录 `HR_OFFBOARDING_SUBJECT_DISABLED` 审计；主体记录不软删除。
- 若目标成员是最后一名有效租户管理员，接口返回 `409 TENANT_LAST_ADMIN`，管理员交接完成后方可批准离职。
- 全部 HR 资源按租户隔离并接入 `DataScopeResolverService`、乐观锁和审计。

## 3. Finance 报销（已实现）

```text
GET    /api/v1/finance/expense-categories
POST   /api/v1/finance/expense-categories
PATCH  /api/v1/finance/expense-categories/{categoryId}
DELETE /api/v1/finance/expense-categories/{categoryId}?version={version}
GET    /api/v1/finance/expense-reports
POST   /api/v1/finance/expense-reports
GET    /api/v1/finance/expense-reports/{reportId}
PATCH  /api/v1/finance/expense-reports/{reportId}
DELETE /api/v1/finance/expense-reports/{reportId}?version={version}
POST   /api/v1/finance/expense-reports/{reportId}/submit
POST   /api/v1/finance/expense-reports/{reportId}/withdraw
POST   /api/v1/finance/expense-reports/{reportId}/cancel
POST   /api/v1/finance/expense-reports/{reportId}/review
POST   /api/v1/finance/expense-reports/{reportId}/mark-paid
GET    /api/v1/finance/reports/expense-summary
GET    /api/v1/finance/reports/project-spend
```

- 创建报销单生成草稿，总金额由服务端对明细求和。
- 草稿、撤回和被拒绝的报销单可修改后重新提交。
- 审批人不得审批自己的报销单；拒绝必须填写意见。
- 付款确认只允许 `APPROVED` 状态，记录付款方式、时间和流水号。
- 费用汇总和项目支出接口为 B、D 提供只读聚合。
- 报销列表支持关键字、状态、报销人、部门、项目、类别和费用发生日期筛选。
- 普通报销人只能引用自己参与的有效项目；`finance.expense.manage_all` 或 `project.manage_all` 可引用当前租户其他有效项目，无效归属返回 `400 FINANCE_EXPENSE_PROJECT_INVALID`。
- 自动报销单号按租户时区年份生成；`attachmentIds` 可省略并按空集合处理。
- 详细边界见 [财务报销与支出数据设计](../architecture/finance-expense-management.md)。

- 报销单包含明细数组，`totalAmount` 由服务端与明细求和校验。
- 审批通过统一 `review` 接口，`decision = APPROVE | REJECT`。

## 4. Legal 合同台账（已实现）

```text
GET    /api/v1/legal/contracts
POST   /api/v1/legal/contracts
GET    /api/v1/legal/contracts/{contractId}
PATCH  /api/v1/legal/contracts/{contractId}
DELETE /api/v1/legal/contracts/{contractId}?version={version}
POST   /api/v1/legal/contracts/{contractId}/activate
POST   /api/v1/legal/contracts/{contractId}/mark-pending-renewal
POST   /api/v1/legal/contracts/{contractId}/renew
POST   /api/v1/legal/contracts/{contractId}/terminate
POST   /api/v1/legal/contracts/{contractId}/archive
GET    /api/v1/legal/reports/contract-summary
```

### 4.1 创建与修改

- 新建合同固定为 `DRAFT`，普通创建和修改请求不能直接指定 `status`。
- `contractNo` 未传时由服务端按租户和年份自动生成；手工编号和自动编号均要求租户内唯一。
- `type` 和 `ownerMembershipId` 必填；`currency` 默认 `CNY`，`renewalReminderDays` 默认 30。
- `endDate` 可空，支持无固定期限合同；不为空时必须大于或等于 `startDate`。
- 附件通过 `attachmentIds` 关联当前租户已有 `FileObject`，单合同最多 20 个。
- 普通修改必须携带 `version`；状态变化只能通过动作接口完成。

### 4.2 状态动作

- `activate`：`DRAFT -> ACTIVE`，要求合同已填写 `signedAt`。
- `mark-pending-renewal`：`ACTIVE -> PENDING_RENEWAL`，要求存在 `endDate`。
- `renew`：`PENDING_RENEWAL/EXPIRED -> ACTIVE`，要求 `newEndDate` 晚于原到期日期且不得早于当前租户日期。
- `terminate`：`ACTIVE/PENDING_RENEWAL -> TERMINATED`，必须填写终止日期和原因。
- `archive`：`EXPIRED/TERMINATED -> ARCHIVED`。
- 后台任务按租户时区处理进入续签窗口和合同到期，并写状态历史与系统审计。

### 4.3 查询、数据范围与汇总

- 列表支持关键字、状态、类型、负责人、部门、项目、币种、到期日期和到期窗口筛选。
- 到期窗口与显式到期日期区间按交集组合；`expiringWithinDays` 与非 `ACTIVE/PENDING_RENEWAL` 状态组合时直接返回空页。
- `SELF` 按负责人过滤，部门范围按合同归属部门过滤，项目范围按合同关联项目过滤。
- `legal.contract.manage_all` 必须与接口要求的操作权限组合使用，只放宽当前租户内数据范围，不绕过状态机和乐观锁。
- 汇总返回各状态数量、即将到期数量及按币种分组的生效和到期金额。
- 老板经营概况复用 Legal 应用服务聚合，不直接读取或修改 Legal 数据表。
- 完整规则见 [Legal 合同台账设计](../architecture/legal-contract-ledger.md)。
- 实现位置：`apps/api/src/legal/**`；数据库迁移：`0034_c_legal_contract_fullstack`；Desktop 入口：`/legal`。
- 自动到期与续签提醒由统一后台任务执行，系统动作保留状态历史和审计记录。
- 进入续签提醒期或自动到期时向负责人发送站内通知（`relationType = LEGAL_CONTRACT`），通知按「合同 + 到期日」去重，审计记录带上 `notificationId`。
- 普通 PATCH 仅在 `DRAFT` 接受编号、名称、对方、类型、金额、币种和日期字段；`ACTIVE`、`PENDING_RENEWAL` 只能改描述、负责人、归属、附件和提醒天数，其余字段返回 `409`。

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
