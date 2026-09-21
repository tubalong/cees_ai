# 角色化首页实现说明

> 实现日期：2026-09-21
> 契约版本：`0.34.0`
> 状态：已落地（HR 首页指标暂缓）

## 1. 已实现范围

- 按权限能力位判定 `EXECUTIVE`、`MANAGER`、`EMPLOYEE` 三种骨架；
- 按权限并集判定 `FINANCE`、`LEGAL`、`HR`、`PROJECT` 职能域；
- 新增桌面端角色化首页，员工、管理层、经营层使用不同卡片排序和信息密度；
- 财务首页增加昨日/本月收支、待支付和台账上传入口；
- 法务首页增加合同状态漏斗和 90 天到期预警；
- 经营层增加项目健康度散点图、关键指标和异常提醒；
- `tasks.completedAt` 迁移、历史回填和状态流转维护；
- 日/月通用指标快照及趋势查询；
- 财务收支台账批次、明细、幂等导入、错误统计和回滚；
- 工作台项目、任务、报告、会议查询统一使用 `DataScopeResolverService`。

## 2. 后端接口

| 接口 | 用途 | 权限 |
| --- | --- | --- |
| `GET /api/v1/dashboard/home` | 返回骨架、职能域、卡片和异常 | `dashboard.read` |
| `GET /api/v1/dashboard/trends` | 查询日/月快照序列 | `dashboard.read` |
| `POST /api/v1/dashboard/snapshots/rebuild` | 重算指定租户指定日期的日/月快照 | `dashboard.read` + `role.assign` |
| `GET /api/v1/finance/ledger-entries` | 查询收支台账 | `finance.ledger.read` |
| `POST /api/v1/finance/ledger-imports` | 提交结构化台账行并导入 | `finance.ledger.manage` |
| `GET /api/v1/finance/ledger-imports/:id` | 查询导入批次结果 | `finance.ledger.read` |
| `DELETE /api/v1/finance/ledger-imports/:id` | 回滚导入批次 | `finance.ledger.manage` |

快照采用设计文档推荐的外部调度方式。API 提供受保护重算端点，生产环境由部署平台的 cron 调用，避免多实例重复执行；台账导入成功后会主动重算受影响日期。

## 3. 数据模型与口径

### 任务完成时间

新增 `tasks.completed_at` 及租户/项目索引。任务进入 `DONE` 时写入当前时间，`DONE → IN_PROGRESS` 时必须提供重开原因并清空时间。迁移会从 `task_activities` 中当前仍为 `DONE` 的任务回填最近一次 `toStatus = DONE` 的时间，无法还原的历史任务保持为空。

### 财务台账

新增 `finance_ledger_imports` 和 `finance_ledger_entries`。科目先采用自由文本，金额恒为正数，由 `direction` 区分收入和支出。幂等键为租户、方向、发生日期和凭证号，重复记录进入 `skippedCount`。

桌面端沿用组织导入的 XLSX 解析模式：文件在客户端解析成 JSON 行数组，API 负责租户归属、日期、币种、金额、部门和项目校验。

### 快照

新增 `dashboard_metric_snapshots`，支持 `DAY` / `MONTH` 两种周期和非空 `scopeKey`。流量指标可按日/月累加，逾期和待支付等存量指标以快照时点值保存。

所有昨日、今日、本月边界均按 `tenants.timezone` 计算；首页无权限域不会返回对应卡片。

## 4. 桌面端卡片

实现位置：`apps/desktop/src/features/dashboard/`。

- 执行层：今日聚焦、今日会议、日报提醒、未读通知；
- 管理层：关键指标、项目健康度、待我审批；
- 经营层：关键指标、项目健康度、财务收支和法务风险；
- 财务域：昨日/本月收支、待支付、台账上传；
- 法务域：合同漏斗、到期预警。

ECharts 复用已有依赖，目前落地项目健康度散点图；收支趋势接口已经可用，后续可在不改 API 的情况下追加趋势折线卡。

## 5. 暂缓与后续

- HR 首页指标暂缓，等待工作日历解决出勤和日报应提交人数分母问题；
- 租户可配置异常阈值暂缓，当前异常规则使用稳定的固定业务条件；
- 经营层收入/支出趋势图的桌面展示可直接消费 `/dashboard/trends`，当前首页先展示快照摘要；
- 用户自定义拖拽布局、布局持久化和跨租户看板不在本次范围。

## 6. 验证记录

已执行并通过：

```text
prisma validate
prisma migrate deploy
API build
dashboard/task/finance/legal 定向 Jest：43 passed
desktop tsc -b
desktop production build
OpenAPI lint
公开客户端生成
```

`pnpm contracts:check` 的生成阶段成功；最后的 `git diff --exit-code` 会因为本次契约新增生成物尚未提交而按预期返回差异，生成文件已同步到 `packages/api-client/src`。