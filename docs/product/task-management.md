# 项目任务管理

> 状态：已落地
> 最后同步：2026-09-09
> 公开契约版本：`0.13.1`

## 1. 功能范围

任务体系归属于项目，业务事实源位于 `apps/api`。当前实现包括：

- 项目内任务创建、查询、修改和软删除；
- 最多 10 层父子任务；
- 一个任务负责人和多个协作人；
- 任务状态流转、评论、COS 文件附件和操作动态；
- 项目成员边界、项目角色和任务角色联合授权；
- 乐观锁、租户审计和 PostgreSQL 字段注释。

任务接口不接受独立的 `tenantId`。租户由 Access Token 和请求上下文确定，所有查询同时校验 `tenant_id`、`project_id` 和当前项目成员关系。

## 2. 访问与管理边界

- 只有尚未被移出的项目成员才能访问项目任务；
- `project.manage_all` 不绕过任务的项目成员校验；
- 项目 `OWNER/MANAGER` 或任务 `OWNER` 可以修改任务资料、执行人和删除任务；
- 任务负责人、协作人以及项目 `OWNER/MANAGER` 可以变更任务状态；
- 具有对应 RBAC 权限的项目成员可以新增评论和附件；
- 评论作者或任务管理者可以修改、删除评论；
- 附件添加者或任务管理者可以移除附件关系。

租户 RBAC 决定成员是否拥有某项能力，项目角色和任务角色决定成员能否操作具体项目、任务。两类校验必须同时通过。

## 3. 状态机

允许的状态流转如下：

```text
TODO ───────────────→ IN_PROGRESS ─────→ DONE
 │                         │               ↑
 │                         ├────→ BLOCKED ─┘
 │                         │         │
 └────→ CANCELLED          └─────────┴────→ CANCELLED
                           BLOCKED ───────→ IN_PROGRESS
```

具体规则：

| 当前状态 | 可流转到 |
| --- | --- |
| `TODO` | `IN_PROGRESS`、`CANCELLED` |
| `IN_PROGRESS` | `BLOCKED`、`DONE`、`CANCELLED` |
| `BLOCKED` | `IN_PROGRESS`、`DONE`、`CANCELLED` |
| `DONE` | 无 |
| `CANCELLED` | 无 |

流转到 `BLOCKED` 或 `CANCELLED` 必须填写 `reason`。`DONE` 和 `CANCELLED` 是任务终态，终态任务不能继续修改资料和执行人。

## 4. 父子任务

- `parentId = null` 表示根任务；
- 父任务必须属于同一租户、同一项目且未删除；
- 任务不能把自己或自己的后代设为父任务；
- 调整父任务时会同时计算现有子树深度；
- 任意任务链最多 10 层；
- 有未删除子任务的任务不能删除。

## 5. 执行人

每个任务必须有且只能有一个 `OWNER`，可以有最多 100 个 `COLLABORATOR`。负责人和协作人必须是当前项目内尚未移出的有效租户成员，负责人不能同时出现在协作人列表。

执行人接口采用整体替换语义：客户端提交新的负责人、完整协作人集合和当前任务 `version`。项目成员如果仍负责或协作 `TODO/IN_PROGRESS/BLOCKED` 任务，将不能被移出项目。

## 6. 评论、附件和动态

- 评论支持分页、修改、软删除和乐观锁；
- 评论和动态分页的 `limit` 默认均为 20，最大为 100；
- 创建任务未指定优先级时默认使用 `MEDIUM`；
- 附件只能关联当前租户中已经完成上传的 `FileObject`；
- 移除附件只软删除任务附件关系，不删除 COS 对象和 `file_objects`；
- 任务创建、资料修改、状态变化、执行人变化、评论和附件操作都会写入 `task_activities`；
- 同一写事务还会写入租户 `audit_logs`，动态用于业务时间线，审计用于安全追踪。

## 7. 项目状态联动

`COMPLETED`、`CANCELLED` 和 `ARCHIVED` 项目为只读：

- 可以查询任务、评论、附件和动态；
- 不能创建、修改、删除任务；
- 不能变更状态和执行人；
- 不能新增、修改或删除评论、附件关系。

项目完成接口要求不存在 `TODO/IN_PROGRESS/BLOCKED` 任务。需要继续工作时，应先通过项目重开接口将 `COMPLETED` 恢复为 `ACTIVE`。

## 8. 并发一致性

项目与任务写操作使用 `projects` 行级事务锁串行化。同一项目的任务创建、修改、删除、状态流转、执行人替换、评论和附件写入，以及项目资料、成员和状态变更，都会先执行项目行 `SELECT ... FOR UPDATE`，然后在同一个 Prisma 事务中重新查询并校验：

- 项目仍存在、当前操作者仍有项目访问权且项目仍可写；
- 任务、评论、附件和父任务仍然有效；
- 负责人和协作人仍是有效项目成员；
- 项目完成时仍不存在未完成任务；
- 移除项目成员时仍不存在其承担的活动任务。

因此并发请求会按获得项目锁的顺序执行。例如项目完成先提交时，等待中的任务创建会重新读取到只读状态并返回 `409 PROJECT_READ_ONLY`；任务创建先提交时，等待中的项目完成会读取到未完成任务并返回 `409 PROJECT_HAS_UNFINISHED_TASKS`。该机制也避免并发调整父任务形成循环，以及删除父任务后又写入子任务、评论或附件。

`version` 乐观锁继续用于识别同一资源的客户端旧版本；项目行锁用于保护跨资源业务不变量，两者不能互相替代。

## 9. 数据与迁移

主要数据表：

- `tasks`：任务资料、父子关系、状态和版本；
- `task_assignees`：负责人和协作人；
- `task_comments`：评论；
- `task_attachments`：任务和 COS 文件对象关系；
- `task_activities`：任务业务动态。

数据库迁移：

- `0006_task_management`：成员关系、外键、索引、唯一负责人约束和 `task.*` 权限；
- `0007_task_database_comments`：任务相关表和字段的 PostgreSQL 中文注释。

本次并发加固不修改数据库结构，不需要新增 Prisma migration。

## 10. 契约与实现入口

- OpenAPI：`packages/contracts/openapi/openapi.yaml`
- 生成客户端：`packages/api-client/src/services/TaskService.ts`
- 控制器：`apps/api/src/task/task.controller.ts`
- 服务：`apps/api/src/task/task.service.ts`
- 项目事务锁：`apps/api/src/project/project-transaction-lock.ts`
- DTO：`apps/api/src/task/dto.ts`
- Prisma：`apps/api/prisma/schema.prisma`
- API 明细：[任务管理 API](../api/task-management-api.md)

## 10. 暂缓范围

- 看板列和自定义任务状态；
- 工时登记、任务依赖和里程碑；
- 批量任务导入和批量状态操作；
- 附件预览、病毒扫描和文件生命周期清理；
- 任务订阅、提醒和通知中心联动。
