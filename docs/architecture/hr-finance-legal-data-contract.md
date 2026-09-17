# 人财法数据契约

> 状态：HR 与 Finance 已实现；Legal 契约已冻结待实现
> Owner：C
> 关联：`packages/contracts/openapi/openapi.yaml`、[Legal 合同台账设计](legal-contract-ledger.md)

## 1. 目标

明确 HR、Finance、Legal 与老板经营概况的数据形状，供 B、D 并行对接，同时保持 NestJS 为正式业务数据唯一事实源。

## 2. HR 假勤

- 员工档案以 `membershipId` 为关联主键，避免复制租户成员账号状态。
- 档案字段只包含 HR 展示和审批所需信息；账号、部门和角色仍由租户成员体系维护。
- 请假申请创建后默认进入可审批流程；审批接口使用统一 `review`，`decision = APPROVE | REJECT`。
- 请假余额由请假类型、年份和成员确定，不承载额度扣减之外的复杂考勤规则。
- Prisma 迁移 `0032_c_hr_fullstack` 创建七张 HR 业务表和对应权限，正式数据只由 NestJS 写入。
- 请假余额变更与请假状态变更必须处于同一数据库事务，避免重复扣减或返还。
- 考勤、加班、人事异动和报表查询统一折叠角色数据范围；租户管理员默认获得全部新增 HR 权限。
- 人事异动审批为正式写入动作，审批通过后同步员工档案及必要的组织归属。
- 钉钉自动出勤同步仍暂停；`HrAttendanceSource.DINGTALK` 仅用于恢复后的来源兼容。

## 3. Finance 报销

- 报销类别为租户级字典，编码租户内唯一。
- 报销单包含 `FinanceExpenseItem` 明细，`totalAmount` 由服务端以明细求和校验。
- 状态机覆盖草稿、提交、撤回、拒绝后重编、批准、取消和付款。
- 附件复用 `FileObject`，金额使用 `DECIMAL(18,2)`，审批和付款写入状态历史与审计。
- D 的预算与支出消费 C 的财务域数据时，只读聚合，不直接写回报销事实。
- 完整设计见 [财务报销与支出数据设计](finance-expense-management.md)。

## 4. Legal 合同台账

- 合同为租户级台账，不替代法务审批系统。
- `LegalContractStatus` 覆盖草稿、生效、待续签、到期、终止和归档。
- 负责人、业务部门和项目归属接入 `DataScopeResolverService`；`manage_all` 只放宽当前租户内的数据范围。
- 附件复用 `FileObject`，状态动作写入不可变状态历史和审计。
- 创建、修改、状态动作和删除均使用乐观锁；仅草稿合同允许删除。
- 完整状态机、字段规则、到期任务和兼容说明见 [Legal 合同台账设计](legal-contract-ledger.md)。

## 5. 老板经营概况

`GET /api/v1/boss-overview` 返回只读草稿聚合：

- HR：在职人数、请假中人数、待审批请假数。
- Finance：待审批报销单数、待审批金额。
- Legal：生效合同数、即将到期合同数。
- Task：待办任务数、逾期任务数。

该接口只供 B 的老板经营概况消费，不承载正式业务写入。

## 6. 联网检索租户策略

`GET/PATCH /api/v1/tenants/current/search-policy` 为 B 的联网检索开关提供租户级策略：

- `enabled` 默认关闭。
- `allowedDomains` / `disallowedDomains` 控制允许范围。
- `maxResults` 限制单次来源数量。

## 7. 契约基线

- 所有列表接口按 `items` + `nextCursor` 分页。
- 所有写操作返回稳定资源与 `version`。
- 写接口权限码已加入权限目录，允许自定义角色接入。
- 服务端实现时必须通过 `DataScopeResolverService` 控制 `SELF`、`DEPARTMENT_TREE`、`TENANT` 等范围。
