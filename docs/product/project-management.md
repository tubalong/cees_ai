# 项目与项目成员管理

## 1. 落地状态

截至 2026-09-16，本功能已经落地项目 CRUD、服务端自动编码、项目成员、负责人转移、项目状态机、完成后只读、归档恢复、乐观锁和租户审计。项目任务、评论、附件和动态接口已经落地，详细规则见 [项目任务管理](task-management.md)。

公开契约以 `packages/contracts/openapi/openapi.yaml` 的 `0.27.0` 为准，项目 NestJS 实现在 `apps/api/src/project`，任务实现在 `apps/api/src/task`；数据库迁移包括 `0005_project_management`、`0006_task_management`、`0007_task_database_comments` 和 `0031_project_code_sequence_and_timestamps`。

## 2. 租户与可见性边界

项目属于单一租户，但“同租户”不代表自动获得项目访问权限。访问项目必须同时满足：

```text
有效租户成员身份
AND 对应 project.* RBAC 权限
AND（当前项目成员 OR 拥有 project.manage_all）
```

- 普通成员默认只能看到自己参与的项目；
- 部门只用于业务归属、筛选和统计，不自动授权整个部门访问；
- 无权访问项目时统一返回 `404 PROJECT_NOT_FOUND`，避免泄露项目是否存在；
- 平台超级管理员身份不直接绕过租户业务权限，必须使用有效租户成员身份进入项目；
- 第一版项目不接入通用 `ResourceAcl`，项目范围由项目成员关系负责。

桌面端创建项目时只填写名称，并先选择部门筛选范围（可选“所有部门”）再选择负责人和初始成员；人员选项只展示成员 `displayName`。项目说明在创建后通过项目详情编辑。选择具体部门时只展示该部门直属有效成员，选择“所有部门”时展示全部有效成员；该选择同时作为项目归属部门，选择“所有部门”时保存为空。归属部门是业务归属、筛选和统计字段，**不会**把项目开放给该部门。界面仅用一行提示“只有项目成员可以查看该项目”。

## 2.1 项目编码

- 编码由服务端分配，客户端不提交 `code`，创建弹窗也不展示编码；创建成功后才返回并提示，例如 `PRJ-2026-1`；
- 格式为 `PRJ-<年>-<序号>`，序号按“租户 + 租户时区年份”从 1 递增，跨年重新从 1 开始；
- 年份取租户时区（`tenants.timezone`）下的自然年，因此跨年重置点是租户本地 1 月 1 日 00:00；
- 分配与项目写入在同一事务内完成，`project_code_sequences` 的行锁保证并发创建不重号，`(tenantId, normalizedCode)` 唯一约束兜底；
- 编码创建后不可修改；序号只增不减，软删除的项目不回收编号，历史编码（`PRJ-001`、`legacy-*` 等）保持原样且不参与自动编号；
- 租户调整时区只会改变跨年那段时间的年份归属，不会产生重复编码。

## 2.2 桌面端项目页面

截至 2026-09-17，桌面端项目模块采用列表页与独立详情页两级导航：

- `/projects` 展示响应式项目卡片，卡片宽度限制在合理范围内，并支持网格/列表视图、名称或编号搜索、状态与部门筛选；
- 点击项目卡片进入 `/projects/{projectId}`，不再使用项目详情抽屉；返回操作回到项目列表；
- 详情页概览展示项目状态、负责人、任务完成比例、任务数量、成员数量、最近任务节点、项目描述、近期任务、风险提示和基于系统时间戳的生命周期时间线；
- 任务与成员页签复用现有任务、成员、权限和状态机能力；文件、项目级动态和设置尚无对应项目级契约时只显示未开放占位，不在客户端伪造数据；
- 项目本身没有人工截止日期字段，详情页不会把任务截止日期或历史计划日期伪装成项目截止日期。

## 3. 项目角色

| 角色 | 能力 |
| --- | --- |
| `OWNER` | 唯一当前负责人；可管理项目、成员，完成、重开、归档和转移负责人 |
| `MANAGER` | 可修改未完成项目、管理普通项目成员、执行常规状态流转 |
| `MEMBER` | 在具有对应 RBAC 权限时读取项目和成员信息 |

`Project.ownerMembershipId` 是唯一负责人事实源，并与一个有效的 `ProjectMember.role = OWNER` 保持一致。普通成员修改接口不能设置或移除 `OWNER`；负责人变更必须调用专用转移接口，原负责人自动降为 `MANAGER`。

项目成员使用 `TenantMembership.id`，不使用全局 `User.id`。这样同一自然人在不同租户中的账号、角色和项目身份不会混淆。

## 4. 状态机

```text
PLANNING ─start──> ACTIVE ─pause──> PAUSED
                      ^              │
                      └──resume──────┘

ACTIVE ─complete──> COMPLETED ─archive──> ARCHIVED
   ^                    │                    │
   └──────reopen────────┘                    └──restore──> COMPLETED

PLANNING / ACTIVE / PAUSED ─cancel──> CANCELLED
```

- 状态只能通过命令接口变更，普通 `PATCH /projects/{projectId}` 不能直接修改状态；
- 完成项目仅允许负责人或 `project.manage_all` 执行，并要求 `project.complete`；
- 存在 `TODO`、`IN_PROGRESS` 或 `BLOCKED` 任务时返回 `409 PROJECT_HAS_UNFINISHED_TASKS`；
- `COMPLETED`、`CANCELLED` 和 `ARCHIVED` 项目禁止修改核心资料及成员关系；
- 已完成项目继续工作前必须先 `reopen`；归档项目先 `restore` 为 `COMPLETED`，需要工作时再 `reopen`；
- 每次状态变化写入 `project_status_history`，同时写入租户 `audit_logs`。

## 4.1 项目时间字段

项目不再由创建人填写开始和结束日期，改为三个只读系统时间戳：

| 字段 | 写入时机 | 清除时机 |
| --- | --- | --- |
| `startedAt`（首次启动时间） | 首次 `start`（`PLANNING` → `ACTIVE`） | 不清除，暂停/恢复/重新开启都不覆盖 |
| `completedAt`（完成时间） | `complete` | `reopen` |
| `closedAt`（关闭时间） | `cancel` 与 `archive` | `restore`（归档恢复到已完成）、`reopen` |

因此已完成项目用完成时间表达；被取消或归档关闭的项目用关闭时间表达。`complete` 同时写入 `completedByMembershipId` 和 `completionSummary`，`reopen` 一并清空。

## 5. 删除与历史保留

项目删除只用于录入错误且还没有任务等业务数据的项目。删除采用软删除，并同步软删除项目成员关系。

- 项目存在任何任务时返回 `409 PROJECT_HAS_BUSINESS_DATA`；
- 项目成员仍负责或协作未完成任务时返回 `409 PROJECT_MEMBER_HAS_ACTIVE_TASKS`，必须先调整任务执行人；
- 正式业务项目应使用完成或归档，不使用物理删除；
- 完成和归档不会删除成员、任务、评论、附件或动态历史；
- 项目成员访问范围不会因为项目完成而扩大。

## 6. 并发与审计

修改项目、删除项目、修改或移除成员、转移负责人和状态命令均使用 `version` 乐观锁。版本不一致返回 `409 PROJECT_VERSION_CONFLICT`。

项目资料、成员、状态和项目任务的所有写操作还会在 Prisma 事务开始后锁定对应 `projects` 行，并在获得锁后重新读取权限、状态、成员和任务数据。同一项目的跨资源写入因此串行执行，主要保证：

- 项目完成与任务创建不会同时成功；
- 项目成员移除与任务执行人分配不会同时成功；
- 项目删除与任务、评论或附件写入不会同时成功；
- 并发父子任务调整不会形成循环关系。

项目行锁保护跨表业务不变量，`version` 继续保护单条资源的客户端并发修改。本次加固复用现有 `projects` 主表，不新增数据库字段或迁移。

主要审计动作包括项目创建、修改、删除，成员增删与角色变化，负责人转移，以及全部项目状态命令。审计事件记录租户、操作者 User、操作者 Membership、请求 ID、项目资源 ID、动作和变化元数据。

## 7. 数据模型

- `projects`：项目编码、名称、部门、唯一负责人、状态、首次启动/完成/关闭时间、完成信息和版本；
- `project_code_sequences`：按 `tenant_id + year` 保存项目编码当前序号；
- `project_members`：项目与租户成员关系及 `OWNER/MANAGER/MEMBER` 角色；
- `project_status_history`：不可变的项目状态变化记录；
- `tasks.project_id`：用于任务访问隔离、完成校验和删除保护；任务接口已经实现。

项目编码同租户按规范化小写唯一。迁移 `0005_project_management` 会为旧项目生成 `legacy-<uuid片段>` 编码，并把旧 `user_id` 项目成员关系映射到同租户 Membership；迁移 `0031_project_code_sequence_and_timestamps` 新增 `project_code_sequences`、把 `starts_at` 重命名为 `started_at`、删除人工填写的 `ends_at` 并新增 `closed_at`。**迁移会删除历史计划结束日期**，历史 `starts_at` 值保留但语义变为“首次启动时间”。

## 8. 权限目录

```text
project.create
project.read
project.update
project.delete
project.member.read
project.member.manage
project.complete
project.reopen
project.archive
project.manage_all
```

系统 `tenant_admin` 通过 seed 自动获得上述权限。自定义角色需要显式授权，项目内角色不会替代 RBAC 权限。
