# 会议管理 API

> 状态：已实现  
> 最后同步：2026-09-09  
> 公开契约版本：`0.14.0`

## 1. 通用约定

- 基础路径：`/api/v1`；
- 鉴权：租户成员 Bearer Access Token；
- `tenantId` 不由客户端传入，从令牌和租户上下文确定；
- 更新和删除使用 `version` 乐观锁；
- UUID 路径参数和分页游标必须是合法 UUID；
- 公开契约事实源：`packages/contracts/openapi/openapi.yaml`。

## 2. 接口清单

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/meetings` | `meeting.read` | 查询当前成员可见会议 |
| `POST` | `/meetings` | `meeting.create` | 创建会议草稿 |
| `GET` | `/meetings/{meetingId}` | `meeting.read` | 查询会议详情 |
| `PATCH` | `/meetings/{meetingId}` | `meeting.update` | 修改草稿或已安排会议 |
| `DELETE` | `/meetings/{meetingId}?version=` | `meeting.delete` | 删除会议草稿 |
| `POST` | `/meetings/{meetingId}/transitions` | `meeting.status.update` | 变更会议状态 |
| `GET` | `/meetings/{meetingId}/participants` | `meeting.read` | 查询参会人 |
| `POST` | `/meetings/{meetingId}/participants` | `meeting.participant.manage` | 添加参会人 |
| `PATCH` | `/meetings/{meetingId}/participants/{membershipId}` | `meeting.participant.manage` | 修改角色或出席状态 |
| `DELETE` | `/meetings/{meetingId}/participants/{membershipId}?version=` | `meeting.participant.manage` | 移除参会人 |
| `PATCH` | `/meetings/{meetingId}/participants/me/response` | `meeting.read` | 当前参会人回应邀请 |
| `GET` | `/meetings/{meetingId}/minutes` | `meeting.read` | 查询会议纪要 |
| `PUT` | `/meetings/{meetingId}/minutes` | `meeting.minutes.manage` | 创建或修改纪要草稿 |
| `POST` | `/meetings/{meetingId}/minutes/publish` | `meeting.minutes.manage` | 发布纪要 |
| `POST` | `/meetings/{meetingId}/minutes/reopen` | `meeting.minutes.manage` | 重新打开纪要 |

接口权限只表示 RBAC 能力，服务还会校验具体会议的组织者、主持人、记录人或参会人身份。

## 3. 查询会议

`GET /meetings` 查询参数：

| 参数 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `keyword` | string | - | 模糊匹配标题和描述，最大 100 字符 |
| `status` | `MeetingStatus` | - | 按状态过滤 |
| `projectId` | UUID | - | 按关联项目过滤 |
| `departmentId` | UUID | - | 按归属部门过滤 |
| `startsFrom` | date-time | - | 会议开始时间下界 |
| `startsTo` | date-time | - | 会议开始时间上界 |
| `includeCancelled` | boolean | `false` | 未指定 `status` 时是否包含已取消会议 |
| `limit` | integer | `20` | 1 到 100 |
| `cursor` | UUID | - | 上一页返回的 `nextCursor` |

普通成员只返回自己组织或参与的会议；`meeting.manage_all` 返回当前租户全部匹配会议。

## 4. 创建和修改会议

创建请求示例：

```json
{
  "title": "研发周例会",
  "description": "同步本周研发进展",
  "projectId": "30000000-0000-0000-0000-000000000001",
  "departmentId": "40000000-0000-0000-0000-000000000001",
  "startsAt": "2026-09-10T01:00:00.000Z",
  "durationMinutes": 60,
  "location": "总部 3F 会议室",
  "meetingUrl": null,
  "agenda": [
    {
      "title": "项目进度",
      "description": "各负责人汇报里程碑",
      "sortOrder": 10
    }
  ]
}
```

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `title` | 是 | 1 到 200 字符，去除首尾空白后不能为空 |
| `description` | 否 | 最大 5000 字符，可空 |
| `projectId` | 否 | 当前租户项目；操作者必须是项目成员或有 `project.manage_all` |
| `departmentId` | 否 | 当前租户有效部门 |
| `startsAt` | 是 | ISO 8601 date-time |
| `durationMinutes` | 是 | 1 到 1440 分钟 |
| `location` | 否 | 最大 500 字符 |
| `meetingUrl` | 否 | 合法 URL，最大 2048 字符 |
| `agenda` | 否 | 默认空数组，最多 100 项 |

`PATCH /meetings/{meetingId}` 使用相同可修改字段并要求 `version`。除 `version` 外至少提交一个业务字段。

## 5. 状态流转

```json
{
  "status": "CANCELLED",
  "reason": "客户临时调整日程",
  "version": 3
}
```

`status` 只允许 `SCHEDULED`、`IN_PROGRESS`、`COMPLETED`、`CANCELLED`。取消会议时 `reason` 必填，最大 1000 字符。

## 6. 参会人

添加参会人：

```json
{
  "membershipId": "20000000-0000-0000-0000-000000000002",
  "role": "PARTICIPANT"
}
```

`role` 默认 `PARTICIPANT`，可选 `HOST`、`RECORDER`、`PARTICIPANT`。目标必须是当前租户有效成员。

修改角色或出席状态：

```json
{
  "attendanceStatus": "ATTENDED",
  "version": 2
}
```

- `role` 仅在 `DRAFT/SCHEDULED` 可改；
- `attendanceStatus` 仅在 `IN_PROGRESS/COMPLETED` 可改；
- 至少提交 `role` 或 `attendanceStatus`；
- 组织者角色不能改为非 `HOST`。

当前参会人回应邀请：

```json
{
  "responseStatus": "ACCEPTED",
  "version": 1
}
```

`responseStatus` 只允许 `ACCEPTED`、`DECLINED`、`TENTATIVE`。该接口只修改令牌对应成员自己的参会记录。

## 7. 会议纪要

创建纪要时不传 `version`：

```json
{
  "content": {
    "summary": "完成本周研发进度同步",
    "decisions": ["下周三前完成接口联调"],
    "actionItems": [
      {
        "title": "整理联调问题清单",
        "ownerMembershipId": "20000000-0000-0000-0000-000000000002",
        "dueDate": "2026-09-16T10:00:00.000Z"
      }
    ],
    "notes": "下次会议继续检查完成情况"
  }
}
```

修改已有草稿时必须提交当前纪要 `version`。`decisions` 和 `actionItems` 最多各 100 项；行动项负责人必须是有效参会人。

发布和重开请求：

```json
{
  "version": 2
}
```

- 只有 `COMPLETED` 会议可以发布纪要；
- `RECORDER` 可以保存草稿，但只有组织者、`HOST` 或 `meeting.manage_all` 可以发布和重开；
- 已发布纪要修改前必须调用 `/minutes/reopen`。

## 8. 核心返回字段

| 资源 | 关键字段 |
| --- | --- |
| 会议 | `organizer`、`agenda`、`participantCount`、`myRole`、`myResponseStatus`、`startedAt`、`completedAt`、`version` |
| 参会人 | `member`、`role`、`responseStatus`、`attendanceStatus`、`respondedAt`、`version` |
| 纪要 | `content`、`status`、`recorder`、`publishedAt`、`publishedBy`、`version` |

三类资源分别维护版本，客户端不能混用会议、参会人和纪要的 `version`。

## 9. 失败语义

| HTTP | 典型错误码 | 含义 |
| --- | --- | --- |
| `400` | `MEETING_DATE_RANGE_INVALID` | 查询时间范围无效 |
| `400` | `MEETING_PROJECT_INVALID` | 关联项目不存在 |
| `400` | `MEETING_MEMBER_INVALID` | 目标不是当前租户有效成员 |
| `400` | `MEETING_CANCEL_REASON_REQUIRED` | 取消会议未填写原因 |
| `403` | `MEETING_MANAGE_FORBIDDEN` | 当前成员不是会议管理者 |
| `403` | `MEETING_PROJECT_ACCESS_FORBIDDEN` | 无权关联项目 |
| `403` | `MEETING_MINUTES_MANAGE_FORBIDDEN` | 无权编辑纪要 |
| `404` | `MEETING_NOT_FOUND` | 会议不存在或当前成员不可见 |
| `404` | `MEETING_PARTICIPANT_NOT_FOUND` | 参会关系不存在 |
| `404` | `MEETING_MINUTES_NOT_FOUND` | 纪要不存在 |
| `409` | `MEETING_STATE_CONFLICT` | 当前状态不允许该操作 |
| `409` | `MEETING_TRANSITION_INVALID` | 非法状态流转 |
| `409` | `MEETING_VERSION_CONFLICT` | 会议版本冲突 |
| `409` | `MEETING_PARTICIPANT_VERSION_CONFLICT` | 参会关系版本冲突 |
| `409` | `MEETING_MINUTES_VERSION_CONFLICT` | 纪要版本冲突 |

客户端收到版本冲突后应重新查询对应资源，展示最新数据，再由用户决定是否重试。

## 10. 兼容与生成

`0.14.0` 是兼容新增版本，在 `0.13.1` 基础上增加会议路径和 Schema，不修改既有操作。契约修改后已重新生成 `packages/api-client`，新增 `MeetingService` 和会议相关 TypeScript 模型。
