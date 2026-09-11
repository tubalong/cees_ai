# 日报与周报 API

> 状态：已实现
> 最后同步：2026-09-11
> 公开契约版本：`0.16.0`

## 1. 通用约定

- 实际路径前缀为 `/api/v1`；
- 所有接口需要租户成员 JWT 和有效租户上下文；
- 返回值统一经过 API 响应包装器处理；
- 分页使用 `limit + cursor`，默认 20 条，最大 100 条；
- 所有 ID 使用 UUID，日期使用 `YYYY-MM-DD`；
- 修改、删除、提交、撤回和审核需要传入当前 `version`。

## 2. 接口清单

| 方法与路径 | 用途 | 请求体或参数 | 权限 |
| --- | --- | --- | --- |
| `GET /work-reports` | 查询可见报告 | `type/status/authorMembershipId/reviewerMembershipId/periodFrom/periodTo/limit/cursor` | `work_report.read` |
| `POST /work-reports/daily` | 创建日报 | `CreateDailyWorkReportRequest` | `work_report.create` |
| `POST /work-reports/weekly` | 创建周报 | `CreateWeeklyWorkReportRequest` | `work_report.create` |
| `GET /work-reports/statistics` | 查询状态统计 | `type/periodFrom/periodTo` | `work_report.read` |
| `GET /work-reports/{workReportId}` | 查询报告详情 | 路径参数 | `work_report.read` |
| `PATCH /work-reports/{workReportId}` | 修改草稿或驳回报告 | `UpdateWorkReportRequest` | `work_report.update` |
| `DELETE /work-reports/{workReportId}` | 软删除报告 | 查询参数 `version` | `work_report.delete` |
| `POST /work-reports/{workReportId}/submit` | 提交报告 | `WorkReportVersionRequest` | `work_report.submit` |
| `POST /work-reports/{workReportId}/withdraw` | 撤回报告 | `WorkReportVersionRequest` | `work_report.submit` |
| `POST /work-reports/{workReportId}/review` | 通过或驳回报告 | `ReviewWorkReportRequest` | `work_report.review` |

## 3. 创建请求示例

```http
POST /api/v1/work-reports/daily
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{
  "reportDate": "2026-09-10",
  "reviewerMembershipId": "20000000-0000-0000-0000-000000000002",
  "content": {
    "completedItems": ["完成会议管理接口"],
    "plannedItems": ["补充日报周报测试"],
    "blockers": [],
    "remarks": null
  },
  "projectIds": ["30000000-0000-0000-0000-000000000001"],
  "taskIds": []
}
```

周报请求把 `reportDate` 替换为周一的 `weekStartDate`，例如 `2026-09-07`。

创建日报和周报的请求字段：

| 字段 | 日报 | 周报 | 约束 |
| --- | --- | --- | --- |
| `reportDate` | 必填 | - | 日报所属日期，格式为 `YYYY-MM-DD` |
| `weekStartDate` | - | 必填 | 周报周一日期，格式为 `YYYY-MM-DD` |
| `reviewerMembershipId` | 必填 | 必填 | 当前租户内除作者外的有效成员 UUID |
| `content` | 必填 | 必填 | 报告结构化内容，见下方字段说明 |
| `projectIds` | 否 | 否 | 最多 50 个，必须是作者可访问的项目 |
| `taskIds` | 否 | 否 | 最多 100 个，且每个任务必须属于关联项目 |

`content` 字段：

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `completedItems` | 字符串数组 | 最多 100 项，每项 1–2000 字符 |
| `plannedItems` | 字符串数组 | 最多 100 项，每项 1–2000 字符 |
| `blockers` | 字符串数组 | 最多 100 项，每项 1–2000 字符 |
| `remarks` | 字符串/null | 最多 5000 字符 |

## 4. 查询参数和返回值

| 参数 | 含义 |
| --- | --- |
| `type` | `DAILY` 或 `WEEKLY` |
| `status` | `DRAFT`、`SUBMITTED`、`APPROVED` 或 `REJECTED` |
| `authorMembershipId` | 按作者过滤 |
| `reviewerMembershipId` | 按审核人过滤 |
| `periodFrom/periodTo` | 按周期开始日期过滤 |
| `limit/cursor` | UUID 游标分页 |

报告返回 `id`、`type`、`periodStart`、`periodEnd`、`content`、`status`、`author`、`reviewer`、`projectIds`、`taskIds`、`submittedAt`、`reviewedAt`、`reviewComment`、`createdAt`、`updatedAt` 和 `version`。

## 5. 校验规则

- 周报的 `weekStartDate` 必须是周一；
- 审核人必须是当前租户内除作者外的有效成员；
- 项目必须是作者参与的项目，任务必须属于关联项目；
- 项目或任务完成、取消或归档后仍可作为历史关联。

## 6. 状态操作

提交和撤回都需要在请求体中传入 `version`。审核请求示例：

```json
{ "decision": "REJECTED", "comment": "请补充阻塞问题", "version": 2 }
```

驳回必须填写非空 `comment`。作者可以修改驳回报告后再次提交。

## 7. 权限和租户边界

所有查询都自动叠加当前 `tenantId`。普通成员不能查看他人的草稿，`work_report.manage_all` 也只在当前租户内生效。

## 8. 乐观锁和事务

服务端使用乐观锁和数据库行锁保证并发一致性。报告写入、关联表写入和审计写入在同一事务中完成。

## 9. 常见错误

| 错误码 | 含义 |
| --- | --- |
| `PAGINATION_CURSOR_INVALID` | 分页游标不存在或不属于当前成员可见范围 |
| `WORK_REPORT_DATE_INVALID` | 日期不符合 `YYYY-MM-DD` |
| `WORK_REPORT_DATE_RANGE_INVALID` | 查询日期范围无效 |
| `WORK_REPORT_WEEK_START_INVALID` | 周报开始日期不是周一 |
| `WORK_REPORT_REVIEWER_INVALID` | 审核人无效或与作者相同 |
| `WORK_REPORT_REVIEW_DECISION_INVALID` | 审核决定不是 `APPROVED` 或 `REJECTED` |
| `WORK_REPORT_REVIEW_COMMENT_REQUIRED` | 驳回报告时未填写审核意见 |
| `WORK_REPORT_PROJECT_INVALID` | 关联项目不存在或已删除 |
| `WORK_REPORT_PROJECT_FORBIDDEN` | 作者不是项目成员 |
| `WORK_REPORT_TASK_INVALID` | 关联任务不存在或已删除 |
| `WORK_REPORT_TASK_PROJECT_MISMATCH` | 任务不属于关联项目 |
| `WORK_REPORT_REVIEW_FORBIDDEN` | 当前成员不是指定审核人或租户管理员 |
| `WORK_REPORT_NOT_EDITABLE` | 当前报告状态不允许修改或删除 |
| `WORK_REPORT_STATUS_CONFLICT` | 当前状态不允许目标操作 |
| `WORK_REPORT_VERSION_CONFLICT` | 乐观锁版本冲突 |
| `WORK_REPORT_PERIOD_EXISTS` | 当前周期已存在有效报告 |
| `WORK_REPORT_NOT_FOUND` | 报告不存在或当前成员不可见 |

## 10. 契约与客户端生成

公开契约的唯一事实源是 `packages/contracts/openapi/openapi.yaml`。修改契约后执行：

```bash
pnpm --filter @cees/contracts generate:public
pnpm --filter @cees/api-client typecheck
```

生成文件位于 `packages/api-client/src/`，不得手工修改。数据库迁移为 `0010_work_report_management`。
