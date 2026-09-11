# 日报与周报管理

> 状态：已落地
> 最后同步：2026-09-11
> 公开契约版本：`0.16.0`

## 1. 功能范围

日报与周报属于租户业务域，业务事实源位于 `apps/api`。当前版本包括：

- 日报、周报的创建、查询、详情、修改和软删除；
- 指定审核人、提交、撤回、通过和驳回；
- 完成事项、计划事项、阻塞问题和备注的结构化内容；
- 报告与项目、任务的关联；
- 租户隔离、可见范围、RBAC、乐观锁、事务行锁和审计。

当前不包含报告附件、报告评论、抄送、定时提醒、自动催交、汇总导出和 AI 自动生成报告。

## 2. 报告周期

日报使用 `reportDate` 创建，服务端将 `periodStart` 和 `periodEnd` 都设置为该日期。周报使用 `weekStartDate` 创建，开始日期必须是周一。

同一租户内，以下字段组合只能存在一份有效报告：

```text
tenantId + authorMembershipId + type + periodStart
```

报告删除采用软删除，删除后可以重新创建同一周期的报告。

## 3. 可见范围和权限

普通成员可以查看自己作为作者的全部有效报告，以及自己作为审核人的非草稿报告。

拥有 `work_report.manage_all` 的成员可以查看并审核当前租户全部报告。部门归属不会自动扩大报告可见范围。

| 权限 | 用途 |
| --- | --- |
| `work_report.create` | 创建日报或周报 |
| `work_report.read` | 查询报告、详情和统计 |
| `work_report.update` | 修改草稿或驳回报告 |
| `work_report.delete` | 删除草稿或驳回报告 |
| `work_report.submit` | 提交或撤回报告 |
| `work_report.review` | 审核报告 |
| `work_report.manage_all` | 管理当前租户全部报告范围 |

## 4. 审核人规则

创建和修改报告时必须指定当前租户内除作者外的有效成员作为审核人。停用、移除或不存在的成员不能担任审核人。

## 5. 状态机

```text
DRAFT ------> SUBMITTED ------> APPROVED
  ^              |                  |
  |              +--------> REJECTED
  |                                  |
  +----------------------------------+

SUBMITTED ------> DRAFT (作者撤回)
REJECTED  ------> SUBMITTED (修改后再次提交)
```

| 当前状态 | 可执行操作 | 目标状态 |
| --- | --- | --- |
| `DRAFT` | 修改、删除、提交 | `SUBMITTED` |
| `SUBMITTED` | 撤回、审核 | `DRAFT`、`APPROVED`、`REJECTED` |
| `REJECTED` | 修改、删除、再次提交 | `SUBMITTED` |
| `APPROVED` | 只读 | 无 |

## 6. 内容和关联

`content` 必须包含 `completedItems`、`plannedItems`、`blockers` 和 `remarks` 四个字段。前三个字段是最多 100 项的非空字符串数组，`remarks` 可以为 `null`。

报告只能关联作者参与的项目，关联任务必须属于报告关联的项目。

内容字段约束：

| 字段 | 含义 | 约束 |
| --- | --- | --- |
| `completedItems` | 已完成事项 | 最多 100 项，每项 1–2000 字符 |
| `plannedItems` | 下一周期计划 | 最多 100 项，每项 1–2000 字符 |
| `blockers` | 阻塞问题 | 最多 100 项，每项 1–2000 字符 |
| `remarks` | 补充备注 | 可为 `null`，最多 5000 字符 |


## 7. 并发一致性

报告的修改、删除、提交、撤回和审核都需要传入当前 `version`。服务端先获取 `work_reports` 行锁，再重新校验租户、权限、状态和版本。

报告周期由数据库部分唯一索引保证，并发创建不依赖前端先查询后再写入。

## 8. 审计和失败语义

所有报告写操作与以下审计动作写入同一事务：

```text
WORK_REPORT_CREATED
WORK_REPORT_UPDATED
WORK_REPORT_DELETED
WORK_REPORT_SUBMITTED
WORK_REPORT_WITHDRAWN
WORK_REPORT_APPROVED
WORK_REPORT_REJECTED
```

常见失败包括 `WORK_REPORT_PERIOD_EXISTS`、`WORK_REPORT_REVIEWER_INVALID`、`WORK_REPORT_PROJECT_FORBIDDEN`、`WORK_REPORT_TASK_PROJECT_MISMATCH`、`WORK_REPORT_STATUS_CONFLICT` 和 `WORK_REPORT_VERSION_CONFLICT`。

## 9. 数据模型和迁移

```text
WorkReport
  |-- authorMembership/reviewerMembership -> TenantMembership
  |-- projects -> WorkReportProject -> Project
  `-- tasks -> WorkReportTask -> Task
```

- `WorkReport` 保存租户、作者、审核人、报告类型、周期、内容、状态和版本；
- `WorkReportProject` 保存报告与项目的关联；
- `WorkReportTask` 保存报告与任务的关联；
- 数据库迁移为 `0010_work_report_management`。

## 10. 契约、实现和验证

公开契约位于 `packages/contracts/openapi/openapi.yaml`，服务端实现位于 `apps/api/src/work-report/`，生成客户端位于 `packages/api-client/src/`。

已验证：

- Prisma schema 校验通过；
- `0001` 至 `0010` 在独立临时 PostgreSQL 数据库迁移通过；
- OpenAPI lint 通过；
- API 客户端 typecheck 通过；
- API 全量测试通过。
