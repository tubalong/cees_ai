# 会议管理

> 状态：已落地  
> 最后同步：2026-09-09  
> 公开契约版本：`0.14.0`

## 1. 功能范围

会议管理属于租户业务域，业务事实源位于 `apps/api`。当前版本包括：

- 会议草稿创建、可见会议列表、详情、修改和软删除；
- `DRAFT → SCHEDULED → IN_PROGRESS → COMPLETED` 状态流转和取消会议；
- 组织者、主持人、记录人和普通参会人角色；
- 邀请应答和实际出席状态；
- 结构化会议议程；
- 会议纪要草稿、发布和重新打开；
- 租户隔离、具体会议访问范围、RBAC、乐观锁、行级事务锁和审计。

当前版本不包含会议附件、通知提醒、重复会议、外部访客、第三方会议平台、录音转写、AI 自动发布纪要和行动项自动创建任务。会议附件涉及 COS 的部分按当前产品决策暂缓。

## 2. 可见范围

普通成员只能访问以下会议：

- 自己是 `organizerMembershipId` 对应组织者的会议；
- 自己仍是有效 `meeting_participants` 记录的会议。

同一租户并不自动获得全部会议可见性。`departmentId` 只表示会议归属部门，不会把会议自动开放给部门全部成员。拥有 `meeting.manage_all` 的成员可以访问和管理当前租户全部会议，但仍不能跨租户访问。

会议关联项目时，创建或修改会议的操作者必须是该项目尚未移除的项目成员，或拥有 `project.manage_all`。

## 3. 角色和管理权限

| 身份 | 能力 |
| --- | --- |
| 组织者 | 创建会议的成员；固定为 `HOST + ACCEPTED`，可以管理会议、参会人和纪要 |
| `HOST` | 可以修改会议、管理参会人、流转会议状态、发布和重开纪要 |
| `RECORDER` | 可以查看和编辑纪要草稿，但不能发布或重开纪要 |
| `PARTICIPANT` | 可以查看会议、回应自己的邀请；纪要发布后可以查看 |
| `meeting.manage_all` | 在当前租户内获得全部会议的资源范围管理权 |

操作必须同时通过接口对应的 RBAC 权限和具体会议角色校验。组织者不能被移除，也不能从 `HOST` 降级为其他角色。其他参会人可以被设置为多个主持人或记录人。

## 4. 会议状态机

```text
DRAFT ─────→ SCHEDULED ─────→ IN_PROGRESS ─────→ COMPLETED
  │              │                  │
  └──────────────┴──────────────────┴──────────→ CANCELLED
```

| 当前状态 | 可流转到 |
| --- | --- |
| `DRAFT` | `SCHEDULED`、`CANCELLED` |
| `SCHEDULED` | `IN_PROGRESS`、`CANCELLED` |
| `IN_PROGRESS` | `COMPLETED`、`CANCELLED` |
| `COMPLETED` | 无 |
| `CANCELLED` | 无 |

补充规则：

- 流转到 `CANCELLED` 必须填写 `reason`；
- `COMPLETED` 和 `CANCELLED` 是终态；
- 会议资料和参会角色仅在 `DRAFT/SCHEDULED` 可修改；
- 实际出席状态仅在 `IN_PROGRESS/COMPLETED` 可登记；
- 只有 `DRAFT` 会议可以软删除；
- 进入 `IN_PROGRESS` 时记录 `startedAt`，进入 `COMPLETED` 时记录 `completedAt`。

## 5. 参会人和邀请

创建会议时，当前成员自动成为组织者并创建参会记录：

```text
role = HOST
responseStatus = ACCEPTED
attendanceStatus = PENDING
```

| 分类 | 值与含义 |
| --- | --- |
| 参会角色 | `HOST` 主持人；`RECORDER` 记录人；`PARTICIPANT` 普通参会人 |
| 邀请应答 | `INVITED` 未回应；`ACCEPTED` 接受；`DECLINED` 拒绝；`TENTATIVE` 待定 |
| 实际出席 | `PENDING` 未登记；`ATTENDED` 已出席；`ABSENT` 缺席 |

参会人只能修改自己的邀请应答。组织者的邀请应答固定为 `ACCEPTED`。移除参会人采用软删除，后续在会议仍可编辑时重新添加会恢复原关系并重置邀请和出席状态。

## 6. 议程和纪要

会议议程 `agenda` 是结构化 JSON 数组，每项包含 `title`、可空 `description` 和 `sortOrder`。服务端按 `sortOrder` 升序保存。

会议纪要 `content` 包含：

- `summary`：会议总结；
- `decisions`：决议字符串数组；
- `actionItems`：行动项数组；
- `notes`：补充记录，可空。

行动项字段包括标题、可选参会人成员 ID 和可选截止时间。行动项负责人必须是当前会议有效参会人。本版本只保存结构化行动项，不自动创建项目任务。

纪要规则：

- 会议进入 `IN_PROGRESS` 后才能创建或修改纪要；
- 一场会议只有一份有效纪要；
- 组织者、主持人和记录人可以编辑草稿；
- 草稿只有组织者、主持人、记录人和 `meeting.manage_all` 可以查看；
- 会议 `COMPLETED` 后，组织者、主持人或 `meeting.manage_all` 可以发布；
- 发布后所有有会议访问权的成员都可以查看；
- 已发布纪要不能直接修改，必须先重新打开为 `DRAFT`。

## 7. 并发一致性

已有会议的资料、状态、参会人和纪要写操作都会在 Prisma 事务内先锁定会议行：

```sql
SELECT id
FROM meetings
WHERE id = CAST($meetingId AS uuid)
  AND tenant_id = CAST($tenantId AS uuid)
FOR UPDATE;
```

获得锁后重新查询会议、权限、状态、参会关系和版本。同一会议上的并发修改会串行执行，避免会议完成后仍添加参会人、纪要发布后仍被并发覆盖。创建关联项目的会议时会先锁定项目行，再重新校验项目和操作者的项目成员关系。

会议、参会人和纪要分别维护 `version`。更新请求必须提交当前版本；成功后版本加一，旧版本请求返回 `409`。

## 8. 权限和审计

会议权限：

```text
meeting.create
meeting.read
meeting.update
meeting.delete
meeting.status.update
meeting.participant.manage
meeting.minutes.manage
meeting.manage_all
```

主要审计动作：

```text
MEETING_CREATED
MEETING_UPDATED
MEETING_DELETED
MEETING_STATUS_CHANGED
MEETING_PARTICIPANT_ADDED
MEETING_PARTICIPANT_UPDATED
MEETING_PARTICIPANT_REMOVED
MEETING_PARTICIPANT_RESPONDED
MEETING_MINUTES_CREATED
MEETING_MINUTES_UPDATED
MEETING_MINUTES_PUBLISHED
MEETING_MINUTES_REOPENED
```

审计与业务修改位于同一事务，资源类型使用 `MEETING`、`MEETING_PARTICIPANT` 和 `MEETING_MINUTES`。

## 9. 数据模型和迁移

```text
Meeting
  ├── organizerMembership -> TenantMembership
  ├── project -> Project?
  ├── department -> Department?
  ├── participants -> MeetingParticipant[] -> TenantMembership
  └── minutes -> MeetingMinutes?
```

- Prisma 事实源：`apps/api/prisma/schema.prisma`；
- 前向迁移：`apps/api/prisma/migrations/0008_meeting_management/migration.sql`；
- 迁移兼容旧占位会议表，回填组织者和参会 Membership；无法安全映射时明确失败，不静默丢数据；
- 迁移创建会议权限，并为已有 `tenant_admin` 角色赋权；
- 会议枚举、三张会议表和全部字段均包含 PostgreSQL 中文注释。

## 10. 验证结果

- OpenAPI lint、Prisma schema validate 通过；
- 全新 PostgreSQL 数据库从 `0001` 到 `0008` 完整迁移通过；
- 会议相关 50 个字段注释已在 PostgreSQL 中确认存在；
- 会议服务单元测试覆盖可见范围、行锁顺序、状态机、组织者保护、邀请应答和纪要权限；
- NestJS 生产构建和公开 TypeScript 客户端类型检查通过。
