# 通用任务 tasks.scope 方案（C/D 协调草案）

> 状态：AssignmentPolicy 解析预览与请假时间窗口过滤已实现；`tasks.scope` 仍未落地，待 D 实现
> Owner：C（与 D 协调）
> 关联：`apps/api/src/task/**`（D）、`apps/api/src/assignment/**`（C）

## 1. 问题

现有任务接口主要围绕项目任务，`tasks.scope` 需要支持项目外任务和跨职能指派，同时避免 C 越界实现 D 的任务模块。

## 2. 分工

- D 继续拥有 `apps/api/src/task/**` 与任务主状态机。
- C 不新增任务表，也不实现任务 CRUD。
- C 提供分配策略契约，供任务创建、指派和预览时解析候选池、兜底规则与请假跳过规则。
- `tasks.scope` 的枚举、索引和迁移由 D 作为任务模块 owner 落地；C 只提出以下协调基线。

## 3. `tasks.scope` 协调基线

```text
PROJECT            项目内任务，沿用现有项目任务语义
CROSS_FUNCTIONAL   项目外/跨职能任务，可指派给任意有效租户成员
```

新增字段或兼容字段应保持默认值，避免破坏现有项目任务：

- `scope`：默认 `PROJECT`。
- `sourceType` / `sourceId`：记录任务来源，满足“带来源追溯”验收。
- `assigneeMembershipIds`：跨职能任务可使用任意有效租户成员。
- `version`：沿用乐观锁。

## 4. 分配策略接入

- 任务分配前调用 `POST /api/v1/assignment/policies/resolve` 预览命中的策略。
- Task 后续把计划执行时间映射为通用 `availabilityWindow.startAt/endAt`，不要求 Assignment 依赖任务表结构。
- 返回 `matchedPolicyId`、`level`、`candidates`、`skippedOnLeave`、`leaveFilterApplied`、`fallbackMode` 和 `sourceTrace`。
- 策略未命中时 `matchedPolicyId = null`，由任务模块回退到项目成员或租户成员。
- `skipOnLeave` 已按时间窗口过滤重叠的已批准请假，fallback 候选也执行相同过滤；正式任务负责人写入前仍需由 D 再次校验。
- 详细规则见 [分配策略请假可用性过滤](assignment-leave-availability.md)。

## 5. 审计与数据范围

- 分配策略的创建、修改、删除与解析已实现，均记录租户、操作者、请求、资源和扩展元数据；`POST /assignment/policies/resolve` 已可供任务模块预览候选池。
- 跨职能任务数据范围遵循现有租户成员体系，不绕过 `DataScopeResolverService`。
- 通用任务的跨职能权限码使用 `task.cross_functional.*`，与项目任务权限隔离。

## 6. 验收口径

- 项目外任务可创建并指派给任意有效租户成员。
- 任务来源可追溯。
- 分配解析和真实请假跳过已有测试覆盖；任务落库与二次校验待 D 接入。
