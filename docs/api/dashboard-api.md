# 工作台与数据看板 API

> 状态：已实现
> 最后同步：2026-09-11
> 公开契约版本：`0.18.0`

## 1. 通用约定

- 实际路径前缀为 `/api/v1`；
- 所有接口需要租户成员 JWT、有效租户上下文和 `dashboard.read`；
- 返回值统一经过 API 响应包装器处理；
- 工作台不会绕过项目、任务、报告、会议和通知本身的读取权限；
- 日期时间使用 ISO 8601，ID 使用 UUID；
- 所有数据均按当前租户和当前成员实时计算。

## 2. 接口清单

| 方法与路径 | 用途 | 参数 | 权限 |
| --- | --- | --- | --- |
| `GET /dashboard/overview` | 查询工作台综合概览 | 无 | `dashboard.read` |
| `GET /dashboard/task-statistics` | 查询可见任务统计 | `projectId/from/to` | `dashboard.read` |
| `GET /dashboard/todos` | 查询任务、报告和会议待办 | `taskLimit/reportLimit/meetingLimit` | `dashboard.read` |
| `GET /dashboard/upcoming-meetings` | 查询近期会议 | `limit` | `dashboard.read` |

## 3. 工作台概览

```http
GET /api/v1/dashboard/overview
Authorization: Bearer <accessToken>
```

返回结构：

| 分组 | 字段 |
| --- | --- |
| `project` | `total/planning/active/paused/completed/cancelled/archived` |
| `task` | `total/todo/inProgress/blocked/done/cancelled/overdue/completionRate` |
| `report` | `total/draft/submitted/approved/rejected/pendingReview/dailyReportPending` |
| `meeting` | `upcoming/today/pendingResponse` |
| `notification` | `unreadCount` |
| 根对象 | `generatedAt` |

示例：

```yaml
success: true
data:
  project:
    total: 5
    planning: 1
    active: 2
    paused: 0
    completed: 2
    cancelled: 0
    archived: 0
  task:
    total: 18
    todo: 4
    inProgress: 5
    blocked: 1
    done: 8
    cancelled: 2
    overdue: 2
    completionRate: 0.4444
  report:
    total: 10
    draft: 1
    submitted: 2
    approved: 6
    rejected: 1
    pendingReview: 2
    dailyReportPending: false
  meeting:
    upcoming: 3
    today: 1
    pendingResponse: 1
  notification:
    unreadCount: 4
  generatedAt: 2026-09-11T08:00:00.000Z
```

任务 `total` 不包含取消任务，`cancelled` 单独返回。`completionRate` 为 `DONE / 未取消任务总数`，没有任务时返回 `0`。

## 4. 任务统计

```http
GET /api/v1/dashboard/task-statistics?projectId=<projectId>&from=2026-09-01T00:00:00.000Z&to=2026-09-11T23:59:59.999Z
Authorization: Bearer <accessToken>
```

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectId` | UUID | 否 | 只统计指定的可见项目 |
| `from` | date-time | 否 | 任务创建时间下界 |
| `to` | date-time | 否 | 任务创建时间上界 |

返回 `DashboardTaskStatistics`，字段与概览中的 `task` 完全一致。`from` 晚于 `to` 时返回 `400 DASHBOARD_DATE_RANGE_INVALID`。

## 5. 工作台待办

```http
GET /api/v1/dashboard/todos?taskLimit=5&reportLimit=5&meetingLimit=5
Authorization: Bearer <accessToken>
```

| 参数 | 默认值 | 范围 |
| --- | --- | --- |
| `taskLimit` | `5` | `1` 到 `20` |
| `reportLimit` | `5` | `1` 到 `20` |
| `meetingLimit` | `5` | `1` 到 `20` |

### 5.1 任务待办字段

| 字段 | 含义 |
| --- | --- |
| `id` | 任务 UUID |
| `projectId` | 所属项目 UUID |
| `title` | 任务标题 |
| `status` | `TODO/IN_PROGRESS/BLOCKED` |
| `priority` | `LOW/MEDIUM/HIGH/URGENT` |
| `dueDate` | 截止时间，可空 |

### 5.2 报告待办字段

报告待办只返回当前成员作为审核人的 `SUBMITTED` 报告，字段为 `id/type/periodStart/status`。

### 5.3 会议待办字段

会议待办返回 `id/title/startsAt/status/responseStatus`。`responseStatus` 是当前成员的邀请应答状态，全局会议管理者未参会时为 `null`。

## 6. 近期会议

```http
GET /api/v1/dashboard/upcoming-meetings?limit=20
Authorization: Bearer <accessToken>
```

`limit` 默认为 `20`，范围为 `1` 到 `100`。列表按 `startsAt` 升序返回，字段包括：

- `id`；
- `title`；
- `startsAt`；
- `durationMinutes`；
- `status`；
- `projectId`；
- `responseStatus`。

## 7. 权限和失败语义

| 情况 | 结果 |
| --- | --- |
| 缺少 `dashboard.read` | `403 AUTH_PERMISSION_DENIED` |
| 缺少某业务域读取权限 | 对应统计为零，列表为空 |
| 指定不可见 `projectId` | 任务统计返回零，不泄露项目是否存在 |
| 日期范围相反 | `400 DASHBOARD_DATE_RANGE_INVALID` |
| JWT 或租户成员身份失效 | `401` |

工作台读取接口不创建业务审计事件，避免每次打开首页产生大量无业务价值的审计记录。

## 8. 契约与客户端生成

公开契约唯一事实源是 `packages/contracts/openapi/openapi.yaml`。修改接口后执行：

```bash
pnpm --filter @cees/contracts lint
pnpm --filter @cees/contracts generate:public
pnpm --filter @cees/api-client typecheck
```

生成客户端中的 `DashboardService` 提供四个对应方法，生成文件不得手工修改。
