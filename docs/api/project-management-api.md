# 项目管理 API

公开契约版本：`0.13.1`。所有接口使用租户 Access Token，路径基于 `/api/v1`。

## 项目

```text
GET    /projects
POST   /projects
GET    /projects/{projectId}
PATCH  /projects/{projectId}
DELETE /projects/{projectId}?version={version}
```

列表默认隐藏 `ARCHIVED`。普通成员仅返回自己参与的项目，`project.manage_all` 可查询当前租户全部项目。创建时不传 `ownerMembershipId`，默认当前成员为负责人；指定其他负责人需要 `project.manage_all`。

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
| 409 | `PROJECT_VERSION_CONFLICT` | 乐观锁版本已过期 |
| 409 | `PROJECT_READ_ONLY` | 项目状态不允许修改资料或成员 |
| 409 | `PROJECT_HAS_UNFINISHED_TASKS` | 存在未完成任务，不能完成项目 |
| 409 | `PROJECT_HAS_BUSINESS_DATA` | 项目已有任务，不能删除 |
| 409 | `PROJECT_MEMBER_HAS_ACTIVE_TASKS` | 成员仍承担未完成任务，不能移出项目 |
| 409 | `PROJECT_STATUS_TRANSITION_INVALID` | 状态流转不符合状态机 |

业务边界和状态机详见 [项目与项目成员管理](../product/project-management.md)。
