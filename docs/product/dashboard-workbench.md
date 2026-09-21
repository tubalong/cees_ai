# 工作台与数据看板

> 状态：已落地（角色化首页扩展见独立实现说明）
> 最后同步：2026-09-11
> 公开契约版本：`0.18.0`

## 1. 功能范围

工作台与数据看板属于租户业务域，业务事实源位于 `apps/api`。当前版本包括：

- 项目状态概览；
- 任务状态、逾期数量和完成率统计；
- 日报周报状态、待审核数量和前一天日报待提交提示；
- 今日会议、近期会议和待回应邀请统计；
- 未读通知数量；
- 当前成员的任务、报告审核和近期会议待办；
- 按项目和创建时间范围查询任务统计；
- 当前成员近期会议列表。

当前基础工作台不包含自定义看板布局、图表配置保存、跨租户平台经营看板和报表导出。角色化首页已增加日/月指标快照与历史趋势查询，详情见 [角色化首页实现说明](role-based-homepage-implementation.md)。

## 2. 权限和数据边界

使用工作台接口首先需要 `dashboard.read`。该权限只允许进入工作台，不会绕过项目、任务、报告、会议和通知各自的数据范围。

| 数据域 | 读取条件 |
| --- | --- |
| 项目 | 需要 `project.read`，普通成员只统计自己参与的项目，`project.manage_all` 可统计当前租户全部项目 |
| 任务 | 需要 `task.read`，只统计当前成员有权访问项目中的任务 |
| 日报周报 | 需要 `work_report.read`，遵循作者、审核人和 `work_report.manage_all` 可见范围 |
| 会议 | 需要 `meeting.read`，普通成员只统计自己组织或参与的会议 |
| 通知 | 需要 `notification.read`，只统计发送给当前用户的通知 |

成员缺少某个业务域的读取权限时，对应统计返回零或空数组，不会通过工作台间接读取该业务数据。所有查询均包含当前 `tenantId`，不能跨租户汇总。

## 3. 工作台概览

概览一次返回项目、任务、报告、会议和通知五组数据。

项目统计包括：

- 全部可见项目数量；
- `PLANNING`、`ACTIVE`、`PAUSED`、`COMPLETED`、`CANCELLED`、`ARCHIVED` 数量。

任务统计包括：

- 未取消任务总数；
- `TODO`、`IN_PROGRESS`、`BLOCKED`、`DONE`、`CANCELLED` 数量；
- 已超过截止时间且尚未完成的逾期任务数量；
- 完成率，计算公式为 `DONE / 未取消任务总数`。

日报周报统计包括当前成员可见报告的状态数量、分配给当前成员的待审核报告数量，以及前一天日报是否仍待提交。

会议统计包括尚未结束或取消的近期会议、租户本地当天会议和当前成员仍为 `INVITED/TENTATIVE` 的待回应会议数量。

## 4. 工作台待办

工作台待办返回三个列表和一个通知数量：

- 任务：当前可见项目中的 `TODO/IN_PROGRESS/BLOCKED` 任务；
- 报告：当前成员作为审核人的 `SUBMITTED` 报告；
- 会议：当前成员可见且开始时间尚未来临的 `DRAFT/SCHEDULED` 会议；
- 通知：当前用户未读通知数量。

任务优先按截止时间升序排列，没有截止时间的任务按数据库排序规则排在后面，再按更新时间倒序。报告按提交时间和周期升序排列，会议按开始时间升序排列。

## 5. 任务统计筛选

任务统计支持可选的 `projectId`、`from` 和 `to`：

- `projectId` 只能统计当前成员有权访问的项目；
- `from/to` 过滤任务创建时间；
- `from` 晚于 `to` 时返回 `DASHBOARD_DATE_RANGE_INVALID`；
- 未传筛选条件时统计当前成员全部可见任务。

## 6. 近期会议

近期会议接口返回当前成员可见的 `DRAFT/SCHEDULED` 会议，开始时间必须不早于请求时刻。普通成员的会议范围由组织者或参会人关系决定，拥有 `meeting.manage_all` 时可以查询当前租户全部近期会议。

返回的 `responseStatus` 是当前成员自己的邀请状态。拥有全局会议管理权限但未参会时，该字段为 `null`。

## 7. 时间规则

- API 时间使用 ISO 8601；
- 今日会议和前一天日报使用**租户时区**（`tenants.timezone`，IANA 标识）日界线，租户时区缺失时回退 `Asia/Shanghai`；
- 任务逾期判断使用服务端当前时间；
- 响应中的 `generatedAt` 表示本次聚合生成时间；
- 基础工作台仍是实时查询；角色化首页的经营趋势和财务收支使用 `dashboard_metric_snapshots` 日/月快照。

## 8. 数据模型和迁移

工作台不新增业务表，实时读取现有：

- `projects` 和 `project_members`；
- `tasks`；
- `work_reports`；
- `meetings` 和 `meeting_participants`；
- `notification_recipients` 和 `notifications`。

迁移 `0012_dashboard_workbench` 只新增 `dashboard.read` 权限，并为已有租户角色授予该权限。后续创建角色时，权限目录会包含 `dashboard.read`。

## 9. 性能与后续方向

当前版本面向现阶段数据量采用实时查询，避免提前创建重复统计表。数据量增长后可以继续演进：

- 使用 PostgreSQL 聚合查询减少记录回传；
- 为高频时间范围增加针对性索引；
- 增加 Redis 短期缓存和租户级缓存失效；
- 增加按日统计快照和趋势图；
- 增加租户管理员团队看板和平台管理员跨租户经营看板。

角色化首页（骨架原型 × 职能域、经营层视图、财务收支台账、每日/每月指标快照）的规划与决策见 [角色化首页与经营看板](role-based-homepage.md)。其中第 12 节记录了当前工作台只用 `*.manage_all` 判断数据范围、未复用 `DataScopeResolverService` 的一致性问题。

## 10. 契约、实现和验证

- 公开契约：`packages/contracts/openapi/openapi.yaml`；
- API 实现：`apps/api/src/dashboard`；
- 权限迁移：`apps/api/prisma/migrations/0012_dashboard_workbench`；
- 生成客户端：`packages/api-client/src`；
- API 说明：[工作台与数据看板 API](../api/dashboard-api.md)。

验证命令：

```bash
pnpm --filter @cees/contracts lint
pnpm --filter @cees/contracts generate:public
pnpm --filter @cees/api-client typecheck
pnpm --filter @cees/api build
pnpm --filter @cees/api test
pnpm --filter @cees/api exec prisma validate
```
