# 分配策略与人财法 MVP（C 后端主体与分配）

> 状态：AssignmentPolicy 已实现（API + Desktop）；HR/Finance/Legal 与 tasks.scope 仍为契约草案
> Owner：C
> 当前版本：AssignmentPolicy 后端与桌面端已落地，具备 CRUD、解析预览、审计和测试；HR/Finance/Legal 仅完成 OpenAPI 契约。

## 1. 目标

后端主体（租户/组织/角色权限）+ 通用任务与分配策略 + 人财法 MVP。

## 2. 范围与状态

| 能力 | 状态 |
| --- | --- |
| 租户、组织、角色权限边界复检 | 已落地，见 [后端主体 P0 复检](../architecture/backend-subject-p0-review.md) |
| 权限目录扩展与自定义角色接入 | 已落地，权限码已进入 `permission-catalog.ts` |
| `AssignmentPolicy`：租户默认 + 项目覆盖 | 已实现，见下方行为说明 |
| 通用任务 `tasks.scope` | 契约草案，待 D 落地 `tasks` 表与任务模块边界 |
| HR 假勤优先 | 契约草案，页面与 API 未实现 |
| Finance 报销 | 契约草案，页面与 API 未实现 |
| Legal 合同台账 | 契约草案，页面与 API 未实现 |
| P2：智能跳过请假人员 | 当前为策略字段和解析占位，待接入真实请假数据 |
| 钉钉出勤同步 | 暂停，恢复后实现 |

## 3. AssignmentPolicy 已落地行为

- 管理员可在“分配策略”页面按领域配置租户默认策略或项目覆盖策略。
- 策略字段：`domain`、`level`、`projectId`、`name`、`description`、候选池、`skipOnLeave`、`fallbackMode`、`enabled`。
- 候选池支持 `membershipIds`、`departmentIds`、`projectIds` 三类来源。
- 解析优先级：项目覆盖策略优先；未命中时回退租户默认策略。
- 候选池为空时按 `fallbackMode` 回退到 `PROJECT_MEMBERS` 或 `TENANT_MEMBERS`，`NONE` 不兜底。
- `skipOnLeave` 当前返回 `skippedOnLeave` 占位数组，真实请假过滤在 P2 接入。
- 创建、修改、删除、解析均写审计事件；删除为软删除并使用 `version` 乐观锁。
- 同租户、同领域、同层级、同项目只允许一条活跃策略；删除后可重建。
- 页面入口：`/assignment`，导航显示权限为 `assignment.policy.read`。

## 4. 目录边界

- Desktop UI：
  - `apps/desktop/src/features/assignment/**`
  - `apps/desktop/src/features/hr/**`
  - `apps/desktop/src/features/finance/**`
  - `apps/desktop/src/features/legal/**`
  - 平台管理与角色权限沿用现有目录。
- API：
  - `apps/api/src/assignment`
  - `apps/api/src/hr`
  - `apps/api/src/finance`
  - `apps/api/src/legal`
  - 租户、组织、平台租户、RBAC 沿用现有目录。
- ai-service：仅用于草稿、建议或文本提取，不直接写正式业务数据。

## 5. 依赖与协作

- 依赖 B 的壳层和 `packages/ui-kit`，但 C 不修改 `apps/desktop/src/app/**` 与 `packages/ui-kit/src/**`；桌面导航接线由 B 统一收口。
- 通用任务改造影响 `tasks` 表，需与 D 协调 `apps/api/src/task/**` 的边界。
- 人财法聚合数据供 B 的老板经营概况消费。
- D 的预算与支出依赖 C 的财务域数据。

## 6. 待确认与暂缓

- `DataScopeResolverService` 已具备解析能力；HR/Finance/Legal 落地时按资源类型接入。
- `tasks.scope` 的枚举、索引和迁移待 D 实现。
- HR/Finance/Legal 的状态机、数据范围与审批边界仍是契约草案。
- 钉钉出勤同步当前暂停。

## 7. 验收基线

- P0/P1 通过契约校验、jest 与页面联调。
- AssignmentPolicy 已通过 API 单测和桌面端构建。
- 通用任务与分配策略需持续补齐审计与测试覆盖。
- HR/Finance/Legal 数据范围、审计与状态机落地后复核工程边界。
