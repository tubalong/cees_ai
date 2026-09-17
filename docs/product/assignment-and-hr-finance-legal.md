# 分配策略与人财法（C 后端主体与分配）

> 状态：AssignmentPolicy、HR、Finance 与 Legal 已实现（API + Desktop）；tasks.scope 仍为契约草案
> Owner：C
> 当前版本：AssignmentPolicy、完整 HR、Finance 与 Legal 合同台账已落地。

## 1. 目标

后端主体（租户/组织/角色权限）+ 通用任务与分配策略 + 人财法 MVP。

## 2. 范围与状态

| 能力 | 状态 |
| --- | --- |
| 租户、组织、角色权限边界复检 | 已落地，见 [后端主体 P0 复检](../architecture/backend-subject-p0-review.md) |
| 权限目录扩展与自定义角色接入 | 已落地，权限码已进入 `permission-catalog.ts` |
| `AssignmentPolicy`：租户默认 + 项目覆盖 | 已实现，见下方行为说明 |
| 通用任务 `tasks.scope` | 契约草案，待 D 落地 `tasks` 表与任务模块边界 |
| HR 员工档案、假勤、考勤、加班、异动、报表 | 已实现，页面入口 `/hr` |
| Finance 报销 | 已实现：类别、草稿、审批、付款、附件、统计与页面，入口 `/finance` |
| Legal 合同台账 | 已实现：台账、附件、状态机、到期任务、汇总与页面，入口 `/legal` |
| P2：智能跳过请假人员 | HR 请假数据已具备，AssignmentPolicy 解析接线仍待后续迭代 |
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

## 4.1 HR 已落地行为

- 员工档案与 `TenantMembership` 一对一关联，成员账号、组织身份和角色仍由主体模块维护。
- 手机号、邮箱、证件和紧急联系人采用字段级权限保护：普通档案读取仅展示脱敏值，完整读取与修改由独立权限控制。
- 假期类型支持租户配置；余额按“成员 + 假期类型 + 年度”唯一维护，人工调整必须写明原因并记录审计。
- 请假创建即进入 `SUBMITTED`，提交时冻结余额；通过后从冻结转为已使用，拒绝、撤回或取消时返还可用余额。
- 请假时长由服务端按申请时间与假期单位折算，不再采信客户端 `durationDays`；客户端传值与折算结果不一致时返回 `400 HR_LEAVE_DURATION_MISMATCH`，折算结果低于 0.01 天时返回 `400 HR_LEAVE_DURATION_TOO_SHORT`。
- 折算规则：按租户时区统计起止当日均计入的自然日；`DAY` 取自然日天数，`HALF_DAY` 允许最后一天计半天，`HOUR` 按申请时长除以标准工作日 8 小时折算。
- 同一成员在待审批或已批准状态下的请假时间段不能重叠，重叠返回 `409 HR_LEAVE_REQUEST_OVERLAP`。
- 跨年度申请按租户本地年度拆分额度占用（`yearAllocations`），创建、审批、拒绝、撤回和取消都在同一事务内按年度分别结转余额。
- 员工不能审批本人提交的请假、加班、考勤修正和人事异动，服务端返回 `403 HR_SELF_REVIEW_FORBIDDEN`；需由其他具备审批权限的成员处理。
- 考勤支持手工新增、批量导入、修改和异常复核；`DINGTALK` 来源仅保留数据兼容，自动同步仍暂停。
- 加班申请支持成员发起、本人撤销和数据范围内审批。
- 人事异动覆盖入职、转正、调岗、晋升、降级、离职和解除；审批通过后同步员工档案，调岗同步成员部门。
- 离职和解除审批会同步停用成员登录主体并撤销现有会话，同时保留历史业务关联；最后一名有效租户管理员必须先交接角色。
- `status = TERMINATED` 与 `leaveDate` 只能由离职或解除人事异动写入，员工档案编辑接口会拒绝这两个字段；档案部门变更会同步 `TenantMembership.departmentId`，并额外要求 `department.member.assign` 权限。
- HR 查询统一应用角色 `DataScope`，写操作记录租户、操作者、请求和资源审计信息。
- 报表提供在职人数、请假汇总、考勤汇总和加班汇总，供桌面端及老板经营概况只读消费。

## 4.2 Legal 已落地行为

- 合同支持手工编号或按租户时区年份自动生成 `HT-YYYY-000001` 格式编号。
- 台账记录交易对方、类型、金额、负责人、部门、项目、有效期、提醒天数和正式附件。
- 状态流转为草稿、已生效、待续签、已到期、已终止和已归档；普通 PATCH 不能直接修改状态。
- 后台任务按租户本地日期自动进入续签提醒期并标记到期，自动动作同步写状态历史与审计。
- 查询和汇总统一应用负责人、部门、项目数据范围；`legal.contract.manage_all` 仅放宽租户内数据范围。
- Desktop 页面入口为 `/legal`，支持概览、组合筛选、登记编辑、附件、详情和状态操作。

## 5. 依赖与协作

- 依赖 B 的壳层和 `packages/ui-kit`，但 C 不修改 `apps/desktop/src/app/**` 与 `packages/ui-kit/src/**`；桌面导航接线由 B 统一收口。
- 通用任务改造影响 `tasks` 表，需与 D 协调 `apps/api/src/task/**` 的边界。
- 人财法聚合数据供 B 的老板经营概况消费。
- D 的预算与支出依赖 C 的财务域数据。
- 财务页面提供审批和付款历史、组合筛选、全租户报销视图与项目支出聚合。

## 6. 待确认与暂缓

- `DataScopeResolverService` 已由 HR、Finance 与 Legal 接入；Legal 按负责人、部门和项目归属取并集过滤。
- `tasks.scope` 的枚举、索引和迁移待 D 实现。
- Finance 状态机、数据范围与审批边界见 [财务报销与支出数据设计](../architecture/finance-expense-management.md)。
- Legal 状态机、数据范围、附件、到期规则与非审批边界已冻结，见 [Legal 合同台账设计](../architecture/legal-contract-ledger.md)。
- 钉钉出勤同步当前暂停。

## 7. 验收基线

- P0/P1 通过契约校验、jest 与页面联调。
- AssignmentPolicy 已通过 API 单测和桌面端构建。
- 通用任务与分配策略需持续补齐审计与测试覆盖。
- B 的老板经营概况仍需消费 Legal 汇总应用服务，禁止直接读取 Legal 数据表。
