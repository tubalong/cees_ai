# 项目管理 API

公开契约版本：`0.27.0`。所有接口使用租户 Access Token，路径基于 `/api/v1`。

## 项目

```text
GET    /projects
POST   /projects
GET    /projects/{projectId}
PATCH  /projects/{projectId}
DELETE /projects/{projectId}?version={version}
```

列表默认隐藏 `ARCHIVED`。普通成员仅返回自己参与的项目，`project.manage_all` 可查询当前租户全部项目。创建时不传 `ownerMembershipId`，默认当前成员为负责人；指定其他负责人需要 `project.manage_all`。

### 创建请求

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `name` | 是 | 项目名称，1～120 字符 |
| `description` | 否 | 项目说明，最多 2000 字符 |
| `departmentId` | 否 | 归属部门 UUID，仅用于归属、筛选和统计，不授予访问权限 |
| `ownerMembershipId` | 否 | 负责人；默认当前成员，指定其他成员需要 `project.manage_all` |
| `memberMembershipIds` | 否 | 初始成员 UUID 数组，最多 100 个且不重复；需要 `project.member.manage`，负责人由服务端自动加入 |

创建请求不接受 `code`，也不接受任何时间字段：项目编码由服务端在创建成功后按“租户时区年份”分配，格式为 `PRJ-<年>-<序号>`（例如 `PRJ-2026-1`），同一租户每年从 1 开始递增，创建后不可修改。序号只增不减，软删除的项目不回收编号；历史编码（如 `PRJ-001`、`legacy-*`）保持原样。

### 时间字段

`ProjectSummary` 返回三个只读系统时间戳，客户端不能写入：

| 字段 | 含义 |
| --- | --- |
| `startedAt` | 首次启动时间；`start` 命令从 `PLANNING` 流转到 `ACTIVE` 时写入，此后不变 |
| `completedAt` | 完成时间；`complete` 写入，`reopen` 清空 |
| `closedAt` | 关闭时间；`cancel` 与 `archive` 写入，`restore` 清空 |

`PATCH /projects/{projectId}` 只接受 `name`、`description`、`departmentId` 和 `version`；携带 `code` 或时间字段会因契约 `additionalProperties: false` 直接返回 400。

## 项目成员

```text
GET    /projects/{projectId}/members
POST   /projects/{projectId}/members
PATCH  /projects/{projectId}/members/{membershipId}
DELETE /projects/{projectId}/members/{membershipId}?version={version}
PUT    /projects/{projectId}/owner
```

成员参数使用租户 `membershipId`。添加和修改接口只接受 `MANAGER` 或 `MEMBER`；`OWNER` 必须通过负责人转移接口设置。

## 状态命令

```text
POST /projects/{projectId}/start
POST /projects/{projectId}/pause
POST /projects/{projectId}/resume
POST /projects/{projectId}/complete
POST /projects/{projectId}/reopen
POST /projects/{projectId}/cancel
POST /projects/{projectId}/archive
POST /projects/{projectId}/restore
```

每个命令都要求项目 `version`。`reopen` 和 `cancel` 还要求 `reason`；`complete` 可提交 `completionSummary`。

## 常见错误

| HTTP | code | 含义 |
| --- | --- | --- |
| 404 | `PROJECT_NOT_FOUND` | 项目不存在或当前成员不在可见范围 |
| 403 | `PROJECT_MEMBER_MANAGE_DENIED` | 创建时提交初始成员但缺少 `project.member.manage` |
| 409 | `PROJECT_VERSION_CONFLICT` | 乐观锁版本已过期 |
| 409 | `PROJECT_READ_ONLY` | 项目状态不允许修改资料或成员 |
| 409 | `PROJECT_HAS_UNFINISHED_TASKS` | 存在未完成任务，不能完成项目 |
| 409 | `PROJECT_HAS_BUSINESS_DATA` | 项目已有任务，不能删除 |
| 409 | `PROJECT_MEMBER_HAS_ACTIVE_TASKS` | 成员仍承担未完成任务，不能移出项目 |
| 409 | `PROJECT_STATUS_TRANSITION_INVALID` | 状态流转不符合状态机 |

业务边界和状态机详见 [项目与项目成员管理](../product/project-management.md)。
