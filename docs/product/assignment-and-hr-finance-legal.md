# 分配策略与人财法 MVP（C 后端主体与分配）

> 状态：OpenAPI 契约草案已落地，服务端和桌面端尚未实现
> Owner：C
> 当前版本：已完成目录骨架、RBAC 数据范围基础与 C 对外契约草案；API、数据库表和桌面页面待实现。

## 1. 目标

后端主体（租户/组织/角色权限）+ 通用任务与分配策略 + 人财法 MVP。

## 2. 范围

- 租户、组织、角色权限与本期新模块的边界复检。
- 权限目录扩展，自定义角色接入新模块。
- `AssignmentPolicy`：租户默认 + 项目覆盖。
- 通用任务 `tasks.scope`：项目外任务与跨职能指派。
- HR 假勤优先：基础档案、请假、审批。
- Finance：报销单、费用明细、审批与台账。
- Legal：合同台账、状态与附件关联。
- P2：智能跳过请假人员。
- 暂停：钉钉出勤同步。

## 3. 目录边界

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

## 4. 依赖与协作

- 依赖 B 的壳层和 `packages/ui-kit`，但 C 不修改 `apps/desktop/src/app/**` 与 `packages/ui-kit/src/**`。
- 通用任务改造影响 `tasks` 表，需与 D 协调 `apps/api/src/task/**` 的边界。
- 人财法聚合数据供 B 的老板经营概况消费。
- D 的预算与支出依赖 C 的财务域数据。

## 5. 待确认设计点

- `DataScope` 已新增解析器与权限基础；过滤规则待服务端落地。
- 存量租户新增权限的同步方式。
- `AssignmentPolicy` 的领域枚举、候选池模型与项目覆盖语义已写入 OpenAPI 草案。
- `tasks.scope` 的枚举、通用任务接口和并发控制已形成 C/D 协调草案，见 [通用任务 tasks.scope 方案](../architecture/task-scope-proposal.md)。
- HR/Finance/Legal 的状态机、数据范围与审批边界已写入 OpenAPI 草案，见 [人财法数据契约](../architecture/hr-finance-legal-data-contract.md)。

## 6. 验收基线

- P0/P1 通过契约校验、jest 与页面联调。
- 通用任务与分配策略有审计与测试覆盖。
- 人财法数据范围、审计与状态机符合工程边界。
