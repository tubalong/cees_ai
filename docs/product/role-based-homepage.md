# 角色化首页与经营看板

> 状态：已落地（HR 域、异常阈值配置和自定义布局暂缓）
> 最后同步：2026-09-21
> 公开契约版本：`0.34.0`

核心实现、迁移与验证记录见 [角色化首页实现说明](role-based-homepage-implementation.md)。

## 1. 目标

当前首页（`apps/desktop/src/app/Workspace.tsx` 的 `HomePage`）对**所有成员使用同一套硬编码布局**：4 个指标卡 + 快捷入口 + 最近文档 + 待办 + AI 助手 + 近期会议。差异只体现在**数据范围（权限）**，不体现在**信息结构**。

本次目标：

- 让不同视野宽度的成员看到**不同的信息结构**，而不只是不同的数字；
- 让**职能岗**（财务、法务）看到本职能域的核心工作面板，而非通用待办；
- 为经营层提供**图形化**的经营视图；
- 保持"权限决定能不能看，原型只决定排在哪"的原则，避免首页成为越权读取通道。

明确不在本次范围：

- **经营健康分（0–100 综合评分）** — 已否决，见第 2 节；
- 用户自定义拖拽布局与布局持久化；
- 跨租户平台经营看板；
- 基于行为画像的自动布局重排（不可解释、不可测试）。

## 2. 已拍板决策

| # | 决策 | 结论 |
| --- | --- | --- |
| 1 | 原型判定方式 | **能力位（权限）驱动**，不硬编码角色 code，不新增 `dashboardProfile` 组织字段 |
| 2 | 经营健康分 | **不做**。老板视图用「关键指标 + 趋势 + 异常」表达，不用综合评分 |
| 3 | `tasks.completedAt` | **做迁移**，见第 8 节 |
| 4 | 趋势数据 | **走每日/每月快照表**，不实时聚合，见第 7 节 |
| 5 | 财务首页口径 | 以**昨日**和**上月**收支为核心，数据由**财务部上传** |
| 6 | 财务与法务首页 | **必须不同**，不能共用一套"专业岗"视图 |

### 权限铁律

> **权限决定「能不能看」，原型只决定「排在哪、占多大」。**

任何卡片在渲染前都必须先通过权限闸门；原型永远不能超出权限范围。缺少某业务域权限时，对应卡片返回 `null` 并从布局中移除，**不返回 0**（0 会被误解为"真的没有"）。

## 3. 模型：骨架 × 职能域

单一的"角色原型"枚举会产生组合爆炸（财务经理、财务专员、法务总监……）。改用**两维正交模型**：

- **骨架（Skeleton）**：由「视野宽度」决定 → 决定网格与卡片顺序；
- **职能域（Domain）**：由「专业权限」决定 → 决定主列插入哪一组专业卡片。

### 3.1 骨架原型

| 骨架 | 判定（能力位，按顺序首个命中） | 成员画像 | 首页要回答的问题 |
| --- | --- | --- | --- |
| `EXECUTIVE` 经营层 | 拥有 ≥3 个「域级全局」权限位 | 总经理、副总 | 昨天怎么样？哪里有异常？ |
| `MANAGER` 管理层 | 拥有任一审阅/审批类权限 + `department.read` | 部门经理、项目负责人 | 团队卡在哪？我要批什么？ |
| `EMPLOYEE` 执行层 | 兜底 | 其余全部成员 | 今天我做什么？ |

「域级全局」权限位定义（用于 `EXECUTIVE` 计数）：

```
project.manage_all
meeting.manage_all
work_report.manage_all
hr.leave.manage_all
finance.expense.manage_all
legal.contract.manage_all
```

审阅/审批类权限位定义（用于 `MANAGER`）：

```
work_report.review
hr.leave.approve
hr.overtime.approve
hr.attendance.approve
hr.employee_change.approve
finance.expense.approve
```

### 3.2 职能域

| 域 | 判定（任一命中） | 首页主列重点 |
| --- | --- | --- |
| `FINANCE` | `finance.expense.manage_all` 或 `finance.ledger.manage` | 昨日/上月收支、报销队列与支付积压 |
| `LEGAL` | `legal.contract.manage_all` | 合同漏斗、到期与续签、风险提醒 |
| `HR` | `hr.profile.manage` 或 `hr.report.read` | 出勤、异动、假勤审批（**暂缓，见 13 节**） |
| `PROJECT` | `project.manage_all` | 项目健康度、停滞项目（可作为 `EXECUTIVE` 的子集） |

**关键设计：新增一个部门 ≠ 新增一个原型。** 加职能域只需在卡片注册表里加一组卡片并补权限位，骨架代码不动。这正是财务与法务能呈现差异化而不失控的原因。

### 3.3 多角色合并

- 骨架取**最高层**：`EXECUTIVE` > `MANAGER` > `EMPLOYEE`；
- 职能域取**并集**，主列可同时插入多组（如同时拥有人事与财务权限的成员）；
- **永不出现两个首页**。

### 3.4 组合示例

| 成员 | 骨架 | 职能域 | 实际看到的首页 |
| --- | --- | --- | --- |
| 总经理 | `EXECUTIVE` | `PROJECT`, `FINANCE`, `LEGAL` | 经营趋势图 + 风险矩阵 + 异常列表 + 财务收支摘要 |
| 财务经理 | `MANAGER` | `FINANCE` | 团队审批队列 + 昨日/上月收支 + 支付积压 |
| 财务专员 | `EMPLOYEE` | `FINANCE` | 我的报销待办 + 收支看板（只读）+ 上传入口 |
| 法务专员 | `EMPLOYEE` | `LEGAL` | 我的合同待办 + 到期日历 + 合同漏斗 |
| 研发工程师 | `EMPLOYEE` | — | 今日聚焦 + 我的任务 + 今日会议 + 日报提醒 |

## 4. 骨架视图指标

### 4.1 `EXECUTIVE` 经营层

老板要的是**结论与异常**，不是明细清单。每个图必须配一句人话解读。

| 卡片 | 口径 | 图形 | 数据来源 |
| --- | --- | --- | --- |
| 昨日关键指标条 | 昨日完成任务数、会议场次、日报提交率、报销发生额、收支净额 | 6 个数字 + 环比箭头 | 快照（`DAY`） |
| 收支走势（30 天） | 收入 / 支出 / 净额三条序列 | 双轴折线 | 快照（`DAY`） |
| 上月收支对比 | 上月收入、支出、净额 + 环比上上月 | 数字 + 条形 | 快照（`MONTH`） |
| 项目健康度矩阵 | X = 任务完成率，Y = 逾期率，气泡 = 成员数 | 散点图 | 新增聚合 |
| 逾期任务 Top 部门 | 按 `department_id` 分组，`due_date < now AND status NOT IN (DONE, CANCELLED)` | 横向条形 | 新增聚合 |
| 停滞项目 | `status = ACTIVE` 且 14 天内无 `tasks.updated_at` 变化 | 列表 | 新增聚合 |
| 异常提醒 | 见 4.4 规则表，最多 5 条，每条一个跳转 | 列表，不用图 | 多源 |
| 资金待付 | `finance_expense_reports` 中 `status = APPROVED` 的笔数、金额、最久等待天数 | 数字 + 预警色 | 现有表 |
| 合同风险 | 30/60/90 天内到期的合同数、`EXPIRED` 未归档数 | 数字 + 列表 | 现有表 |

### 4.2 `MANAGER` 管理层

| 卡片 | 口径 |
| --- | --- |
| 团队日报提交率 | 本部门昨日 `work_reports(type = DAILY)` 去重作者数 / 应提交人数 |
| 待我审批 | 我是 `reviewer_membership_id` 的 `SUBMITTED` 报告 + 各域待我审批项 |
| 团队逾期任务 | 本部门成员名下逾期任务数与 Top 5 |
| 阻塞任务 | `status = BLOCKED`，按 `updated_at` 升序 |
| 本周会议 | 本周 `meetings` 场次与总时长 |
| 团队任务负载 | 按成员分组的未完成任务数 |

### 4.3 `EMPLOYEE` 执行层

| 卡片 | 口径 | 现有接口 |
| --- | --- | --- |
| 今日聚焦 | 从待办中挑选：逾期 > 今天到期 > `priority = URGENT` | `/dashboard/todos` ✅ |
| 我的任务 | 今日到期 / 已逾期 / 进行中 | `/dashboard/todos` ✅ |
| 今日时间轴 | `starts_at` 落今天，含"还有 30 分钟"提示 | `/dashboard/upcoming-meetings` ⚠️ 需补当天范围 |
| 我的日报 | 昨日 `DAILY` 报告缺失或未提交 → 醒目提醒 | `/dashboard/overview` ✅ |
| 我的审批 | 我是审批人的 `SUBMITTED` 项 | ⚠️ 需扇出到各域 |
| 最近文档 / AI 助手 | 复用现有 | ✅ |

### 4.4 异常规则（经营层右栏）

| 规则 | 触发条件 | 严重度 |
| --- | --- | --- |
| 逾期恶化 | 逾期任务数环比前日 ≥ +50% | 高 |
| 项目停滞 | 任一 `ACTIVE` 项目 14 天零任务更新 | 高 |
| 审批堵塞 | 待审报告平均等待 > 48 小时 | 中 |
| 资金待付 | `APPROVED` 报销金额 > 租户阈值 | 高 |
| 费用异动 | 昨日报销额 > 近 30 日均值 × 2 | 中 |
| 协作松懈 | 昨日日报提交率 < 80% | 中 |
| 人才风险 | 本月 `hr_employee_changes` 中离职类记录 > 0 | 高 |
| 合同临界 | 15 天内有合同到期且未进入 `PENDING_RENEWAL` | 高 |

阈值必须租户可配，不做全局常量。

## 5. 职能域视图

### 5.1 财务域 `FINANCE`

> 设计前提：**收支数据由财务部自己上传台账**，系统不自动抓取。首页以「昨日」和「上月」为两个核心时间锚点。

| 卡片 | 口径 | 数据来源 |
| --- | --- | --- |
| 昨日收支 | 收入、支出、净额（`occurred_on` = 租户时区昨日），带前日环比 | 新表 |
| 上月收支 | 收入、支出、净额，带上上月环比 | 快照 `MONTH` |
| 收支趋势 | 近 30 天（日）与近 12 个月（月）双序列 | 快照 |
| 支出构成 | 按科目 Top N 环形 + 按部门横向条形 | 新表 |
| 今日/昨日上传状态 | 昨日台账是否已上传，未上传则醒目提示 | 新表 |
| 待我审批报销 | `status = SUBMITTED`，按 `submitted_at` 升序 | 现有表 |
| 已批准待支付 | `status = APPROVED` 笔数、金额、最早一笔已等待天数 | 现有表 |
| 报销审批时效 | `AVG(reviewed_at - submitted_at)` | 现有表 |
| 本月报销 Top 部门 | `finance_expense_items` 分组求 `SUM(amount)` | 现有表 |
| 台账上传入口 | 跳转导入页 + 模板下载 | 新增页面 |

新增权限位（必须写入 `apps/api/src/rbac/permission-catalog.ts`）：

| 权限位 | 说明 |
| --- | --- |
| `finance.ledger.read` | 查看财务收支台账与收支看板 |
| `finance.ledger.manage` | 上传、修订、回滚财务收支台账 |

### 5.2 法务域 `LEGAL`

> 重要前提：`LegalContract` **没有审批流**，只有状态机（`DRAFT → ACTIVE → PENDING_RENEWAL / EXPIRED / TERMINATED / ARCHIVED`）。因此法务首页的"待办"是**续签、过期、待签署**，不是审批。

| 卡片 | 口径 | 数据来源 |
| --- | --- | --- |
| 合同漏斗 | 各 `status` 数量（`DRAFT` / `ACTIVE` / `PENDING_RENEWAL` / `EXPIRED` / `TERMINATED` / `ARCHIVED`） | 现有表 |
| **到期预警分档** | `status = ACTIVE` 且 `end_date <= today + renewal_reminder_days`，按 ≤15 / ≤30 / ≤60 / ≤90 天分档 | 现有表 |
| 已过期未处理 | `end_date < today` 且 `status` 仍为 `ACTIVE`，或 `status = EXPIRED` 未归档 | 现有表 |
| 待续签 | `status = PENDING_RENEWAL` | 现有表 |
| 在期合同金额 | `SUM(amount) WHERE status = ACTIVE`，按币种分组 | 现有表 |
| 按类型分布 | `type` 分布（`SALES` 占比反映签单情况） | 现有表 |
| 按部门 / 项目 | `department_id` / `project_id` 分组金额与数量 | 现有表 |
| 本月新增与到期 | `created_at` / `end_date` 落在本月 | 现有表 |
| 台账风险 | 缺少 `end_date`、缺少附件、金额超阈值 | 现有表 |
| 我的合同 | `owner_membership_id = me` 或 `department_id ∈ 我的部门` | 现有表 |

### 5.3 人力资源域 `HR`（暂缓）

出勤率、假勤审批、异动、加班需要**工作日历**才能给出准确分母，故推迟到引入最小工作日历之后再实现。

## 6. 财务收支台账（新增数据模型）

### 6.1 存在的问题

现有财务模型**只有支出侧**：

- `finance_expense_reports` / `finance_expense_items` = 员工报销（支出）；
- 全库**没有收入表**，也没有收支台账、科目表、期间对照表。

因此"昨日/上月收支"必须新建模型，且按需求由财务部**上传**产生。

### 6.2 模型草案

```prisma
enum FinanceLedgerDirection {
  INCOME
  EXPENSE
}

enum FinanceLedgerSource {
  IMPORT
  MANUAL
}

enum FinanceLedgerImportStatus {
  PENDING
  PARSING
  SUCCEEDED
  PARTIAL
  FAILED
}

model FinanceLedgerImport {
  id                    String                   @id @default(uuid()) @db.Uuid
  tenantId              String                   @map("tenant_id") @db.Uuid
  fileName              String                   @map("file_name")
  fileObjectId          String?                  @map("file_object_id") @db.Uuid
  format                String                   @default("CSV") @db.VarChar(8)
  periodStart           DateTime                 @map("period_start") @db.Date
  periodEnd             DateTime                 @map("period_end") @db.Date
  status                FinanceLedgerImportStatus @default(PENDING)
  rowCount              Int                      @default(0) @map("row_count")
  importedCount         Int                      @default(0) @map("imported_count")
  skippedCount          Int                      @default(0) @map("skipped_count")
  errorCount            Int                      @default(0) @map("error_count")
  errors                Json?
  uploadedByMembershipId String                  @map("uploaded_by_membership_id") @db.Uuid
  startedAt             DateTime?                @map("started_at")
  finishedAt            DateTime?                @map("finished_at")
  createdAt             DateTime                 @default(now()) @map("created_at")
  updatedAt             DateTime                 @updatedAt @map("updated_at")
  createdBy             String?                  @map("created_by") @db.Uuid
  deletedAt             DateTime?                @map("deleted_at")
  version               Int                      @default(1)

  entries               FinanceLedgerEntry[]

  @@index([tenantId, status, createdAt])
  @@index([tenantId, periodStart])
  @@map("finance_ledger_imports")
}

model FinanceLedgerEntry {
  id             String                 @id @default(uuid()) @db.Uuid
  tenantId       String                 @map("tenant_id") @db.Uuid
  importId       String?                @map("import_id") @db.Uuid
  import         FinanceLedgerImport?   @relation(fields: [importId], references: [id], onDelete: Cascade)
  occurredOn     DateTime               @map("occurred_on") @db.Date
  direction      FinanceLedgerDirection
  amount         Decimal                @db.Decimal(18, 2)
  currency       String                 @default("CNY") @db.VarChar(3)
  categoryCode   String?                @map("category_code")
  categoryName   String?                @map("category_name")
  departmentId   String?                @map("department_id") @db.Uuid
  projectId      String?                @map("project_id") @db.Uuid
  counterparty   String?
  summary        String?
  voucherNo      String?                @map("voucher_no")
  source         FinanceLedgerSource    @default(IMPORT)
  createdAt      DateTime               @default(now()) @map("created_at")
  updatedAt      DateTime               @updatedAt @map("updated_at")
  createdBy      String?                @map("created_by") @db.Uuid
  updatedBy      String?                @map("updated_by") @db.Uuid
  deletedAt      DateTime?              @map("deleted_at")
  version        Int                    @default(1)

  @@unique([tenantId, direction, occurredOn, voucherNo])
  @@index([tenantId, occurredOn, direction])
  @@index([tenantId, departmentId, occurredOn])
  @@index([tenantId, projectId, occurredOn])
  @@index([tenantId, importId])
  @@map("finance_ledger_entries")
}
```

`Tenant` 需同步补两条反向关系字段。

### 6.3 导入流程

```
财务部下载模板 (CSV/XLSX)
  → 前端解析为行数组（与组织成员导入一致，见 docs/product/organization-member-import.md）
  → POST /finance/ledger-imports { periodStart, periodEnd, fileName, rows[] }
  → 服务端逐行校验（日期、方向、金额、科目、部门归属、凭证号）
  → 事务内 upsert（凭证号命中则跳过）→ 写 imported/skipped/error 计数
  → 触发当日与当月的快照重算
  → 返回批次详情，前端展示错误明细并允许修正后重传
```

前置校验必须覆盖：

- `occurredOn` 落在声明期间内；
- `amount > 0`（方向由 `direction` 表达，金额恒为正，避免正负号歧义）；
- `departmentId` 属于当前租户且未删除；
- `currency` 为 3 位大写字母。

### 6.4 幂等与回滚

- **幂等键**：`(tenantId, direction, occurredOn, voucherNo)` 唯一。重复上传同一凭证号计入 `skippedCount`，不报错。
- **回滚**：删除 `finance_ledger_imports` 记录时级联删除其 `entries`（软删优先），随后重算受影响日期的快照。
- **手工补录**：`source = MANUAL`，`importId = null`，与导入数据同表同口径。

### 6.5 依赖决策

`apps/api` 目前**没有任何 CSV/Excel 解析库**。可选：

- **方案 A**：仅支持 CSV（含 BOM），手写解析，零新增依赖；
- **方案 B**：新增 `exceljs`（或 `xlsx`）依赖，直接支持财务实际使用的 `.xlsx`。

**推荐方案 B**：财务人员交付的是 Excel，让财务手工另存为 CSV 会增加长期人工出错率。解析优先复用「前端解析、后端只收 JSON 行数组」的既有组织导入模式，可避免服务端处理大文件。

## 7. 指标快照体系

### 7.1 模型草案

单一泛化表，新增指标不需要改表结构：

```prisma
enum DashboardSnapshotPeriod {
  DAY
  MONTH
}

model DashboardMetricSnapshot {
  id          String                   @id @default(uuid()) @db.Uuid
  tenantId    String                   @map("tenant_id") @db.Uuid
  metricKey   String                   @map("metric_key") @db.VarChar(64)
  period      DashboardSnapshotPeriod
  periodStart DateTime                 @map("period_start") @db.Date
  scopeKey    String                   @default("TENANT") @map("scope_key") @db.VarChar(64)
  value       Decimal                  @db.Decimal(20, 4)
  meta        Json?
  computedAt  DateTime                 @default(now()) @map("computed_at")
  updatedAt   DateTime                 @updatedAt @map("updated_at")

  @@unique([tenantId, metricKey, period, periodStart, scopeKey])
  @@index([tenantId, period, periodStart, metricKey])
  @@index([tenantId, metricKey, periodStart])
  @@map("dashboard_metric_snapshots")
}
```

**为什么用 `scopeKey` 而不是 `scopeType + scopeId`：** PostgreSQL 的唯一索引把 `NULL` 视为互不相等，若用可空 `scopeId` 存租户级汇总行，`@@unique` 无法去重，`upsert` 会不断插入重复行。`scopeKey` 用非空文本表达维度：

```
TENANT
DEPARTMENT:<departmentId>
PROJECT:<projectId>
MEMBER:<membershipId>
```

维度可扩展且不破坏唯一约束。

### 7.2 指标键命名规范

`<域>.<对象>.<度量>`，全小写点分隔，禁止在键里编码时间或维度：

| 指标键 | 含义 |
| --- | --- |
| `task.created.count` | 当日新增任务数 |
| `task.done.count` | 当日完成任务数（依赖 `completed_at`） |
| `task.overdue.count` | 期末逾期任务数（快照值，非流量） |
| `meeting.held.count` | 当日完成会议场次 |
| `meeting.duration.minutes` | 当日会议总时长 |
| `report.daily.submitted.count` | 当日提交日报数 |
| `report.daily.submit_rate` | 当日日报提交率 |
| `report.approval.avg_hours` | 报告平均审批时长 |
| `finance.income.amount` | 当日收入金额 |
| `finance.expense.amount` | 当日支出金额 |
| `finance.expense.net_amount` | 当日净额（收入 − 支出） |
| `finance.reimburse.amount` | 当日报销发生额 |
| `finance.reimburse.pending.amount` | 期末已批准待支付金额（快照值） |
| `legal.contract.expiring.count` | 期末临近到期合同数（快照值） |
| `hr.attendance.rate` | 当日出勤率 |
| `hr.employee_change.attrition.count` | 当月离职数 |
| `ai.turn.count` | 当日 AI 交互轮次 |

命名必须区分**流量指标**（当日发生，可累加）与**存量指标**（期末状态，不可累加）。存量指标名以 `count` / `amount` 结尾并在 `meta` 中标记 `gauge: true`，趋势图禁止对其做求和。

### 7.3 聚合任务

- 服务：`DashboardSnapshotService.rebuildTenantDay(tenantId, dateKey)`，全部使用 `upsert`，可重复执行且结果一致；
- 月快照：由该月已存在的日快照汇总，不重新扫描业务表（除了无法日聚合的存量指标）；
- 触发方式：`apps/api` 目前**没有** `@nestjs/schedule` 或任何 cron 基础设施。需要决策：
  - **方案 A**：引入 `@nestjs/schedule`，在 API 进程内跑每日聚合；
  - **方案 B**：提供受保护的管理端点（如 `POST /internal/dashboard-snapshots/rebuild`），由部署环境的基础设施 cron 调用。

**推荐方案 B**：多实例部署时不会重复执行，且可手工补算历史日期，运维可控。无论选哪种，都必须保证「当日实时 + 历史快照」的拼接口径一致，避免首页趋势图在跨天时出现跳变。

另需处理**时区边界**：日快照的 `periodStart` 必须按 `tenants.timezone` 计算日期（复用 `apps/api/src/common/tenant-time.ts`），不能用 UTC 或服务端本地时间。

## 8. `tasks.completedAt` 迁移

### 8.1 现状问题

`tasks` 表只有 `due_date`、`created_at`、`updated_at`，**没有完成时间**。任何编辑（改标题、加评论、换负责人）都会刷新 `updated_at`，因此：

- "昨日完成任务数"无法计算；
- "任务吞吐趋势"无法计算；
- "平均完成周期"无法计算。

### 8.2 迁移内容

```prisma
  completedAt DateTime? @map("completed_at")

  @@index([tenantId, completedAt])
  @@index([tenantId, projectId, completedAt])
```

### 8.3 写入规则

- 状态流转**进入** `DONE`（`changeTaskStatus`，`apps/api/src/task/task.service.ts`）时设置 `completedAt = now()`；
- 状态**离开** `DONE`（`DONE → IN_PROGRESS` 等重开流转）时清空为 `null`，同时写入一条 `TASK_STATUS_CHANGED` 动态（`metadata.reason` 记重开原因）；
- 必须在**同一个事务**内与 `tasks.updateMany`、`taskActivity.create` 一起提交，保持现有版本冲突检测不变。

### 8.4 历史回填（可行，已验证）

`task_activities` 表已经记录了完整的状态流转：`action = 'TASK_STATUS_CHANGED'`，`metadata = { fromStatus, toStatus, reason }`。因此可回填：

```sql
UPDATE tasks t
SET completed_at = s.created_at
FROM (
  SELECT DISTINCT ON (task_id) task_id, created_at
  FROM task_activities
  WHERE action = 'TASK_STATUS_CHANGED'
    AND metadata->>'toStatus' = 'DONE'
  ORDER BY task_id, created_at DESC
) s
WHERE t.id = s.task_id
  AND t.status = 'DONE'
  AND t.completed_at IS NULL;
```

约束：

- 只回填**当前仍为 `DONE`** 的任务，历史循环完成/重开的中间态无法还原；
- 若任务状态为 `DONE` 但已无对应动态记录，保持 `null`（不回退到 `updated_at`，避免污染趋势）；
- 回填脚本必须在**同一迁移或迁移后的运维脚本**中执行并记入文档，执行日期即趋势图的口径生效日，前端需在趋势图底注中标注。

## 9. 接口设计

### 9.1 统一首页入口

```
GET /api/v1/dashboard/home
```

```ts
{
  archetype: {
    skeleton: 'EXECUTIVE' | 'MANAGER' | 'EMPLOYEE',
    domains: Array<'FINANCE' | 'LEGAL' | 'HR' | 'PROJECT'>,
    reason: string[];            // 命中的能力位，便于排查与支持
  },
  cards: Array<{
    key: string;                 // 与前端注册表对应，如 'finance.yesterdayLedger'
    span: 'FULL' | 'HALF' | 'THIRD';
    payload: unknown | null;     // 无权限时为 null，前端直接移除该卡片
    link?: string;
    empty?: 'NEW_TENANT' | 'NO_DATA' | null;
  }>,
  generatedAt: string;
}
```

设计约束：

- **服务端按权限裁剪卡片**，前端只渲染返回的卡片；
- 前端保留一份 `key → 渲染器` 注册表，**遇到未知 key 直接忽略**，实现前后端独立演进；
- 新增卡片（如法务到期日历）只需后端加 key + 前端加渲染器，不改动布局代码。

### 9.2 其余接口

| 接口 | 用途 | 状态 |
| --- | --- | --- |
| `GET /dashboard/executive` | 经营层一次性聚合（趋势 + 风险 + 跨域摘要） | 新增 |
| `GET /dashboard/trends?metrics=&period=DAY\|MONTH&from=&to=` | 快照序列查询，支持多指标 | 新增 |
| `GET /finance/ledger-entries` | 台账分页查询（方向、期间、科目、部门、项目筛选） | 新增 |
| `POST /finance/ledger-imports` | 上传导入批次 | 新增 |
| `GET /finance/ledger-imports/:id` | 批次状态与错误明细 | 新增 |
| `GET /finance/ledger-imports/template` | 模板下载 | 新增 |
| `DELETE /finance/ledger-imports/:id` | 回滚整批 | 新增 |
| `GET /dashboard/overview` | 现有概览 | 保留 |
| `GET /dashboard/tasks/statistics` | 现有任务统计 | 保留 |
| `GET /dashboard/todos` | 现有待办 | 保留，`EXECUTIVE` 骨架不使用 |
| `GET /dashboard/upcoming-meetings` | 现有近期会议 | 保留，需补"今天"范围 |

所有契约变更必须先在 `packages/contracts/openapi/openapi.yaml` 落地，再执行 `pnpm contracts:gen` 重新生成 `packages/api-client`，禁止手改生成物（`AGENTS.md` §3）。

## 10. 时间与口径规则

1. **"昨日"/"今天"/"本月"/"上月"一律按 `tenants.timezone` 计算**，复用 `apps/api/src/common/tenant-time.ts`，禁止使用浏览器本地时间或 UTC（延续 `docs/product/dashboard-workbench.md` §7）。
2. 快照的 `periodStart` 为租户时区下的日期零点（`@db.Date`）。
3. 存量指标（期末状态）用于趋势图时按"时点值"绘制，不与流量指标混在同一坐标轴求和。
4. 无权限的业务域返回 `null`（移出布局），不返回 `0`。
5. 首页数据缓存窗口：当日实时部分 ≤ 2 分钟；历史快照不设缓存但有索引保障。
6. 新租户或空数据时，卡片降级为引导态（"去创建第一个项目"），禁止整屏 0。

## 11. 前端结构

新建 `apps/desktop/src/features/dashboard/`：

| 文件 | 职责 |
| --- | --- |
| `HomePage.tsx` | 从 `Workspace.tsx` 抽出，只负责取数、渲染骨架与卡片 |
| `cards.ts` | 卡片注册表：`key` / 标题 i18n key / 渲染器 / 默认 `span` |
| `archetypes.ts` | 布局定义：每种骨架的卡片顺序与占位规则 |
| `DashboardGrid.tsx` | 通用网格：套用布局 → 按返回结果过滤 → 空缺自动补位 |

原则：

- 前端**不判断权限**，完全信任服务端裁剪结果，避免两处规则漂移；
- `echarts` 已在 `apps/desktop/package.json` 依赖中但**全仓库尚未使用**，图形化卡片零新增依赖；
- 抽出 `HomePage` 后 `Workspace.tsx` 体积显著下降，同时**不要碰**其中已注释的文档导航死代码（约 942 行）。

## 12. 权限与数据范围一致性（前置修复）

### 12.1 问题

`apps/api/src/dashboard/dashboard.service.ts` 的 `projectWhere` / `taskWhere` / `reportWhere` / `meetingWhere` **只判断 `*.manage_all` 权限位**，完全未使用 `DataScopeResolverService`。而 HR、财务、法务模块使用 `DataScope`（`SELF` / `DEPARTMENT` / `DEPARTMENT_TREE` / `PROJECT` / `CUSTOM` / `TENANT`）。

后果：一个 `dataScope = TENANT` 但未勾选 `project.manage_all` 的总经理角色，首页数字**偏小且错误**。经营层视图建立在此之上会放大这个错误。

### 12.2 结论

**此项必须在实现经营层视图之前修复**，属于正确性缺陷而非新功能。修复时需要：

- 让 dashboard 各 `where` 与对应业务模块的可见范围判定复用同一套 `DataScopeResolverService` 逻辑；
- 补充针对 `dataScope` 的 jest 用例（现仅有 `dashboard.service.spec.ts` 与 `task-metrics.spec.ts`）；
- 同步更新 `docs/product/dashboard-workbench.md` §2。

## 13. 分阶段计划

| 阶段 | 内容 | 交付物 | 预估 |
| --- | --- | --- | --- |
| **P0** | 冻结卡片清单、原型判定规则、线框 | 本文档 | 已完成 |
| **P1** | `DataScope` 一致性修复 + `tasks.completedAt` 迁移与回填 | API 迁移 + 测试 | 1 天 |
| **P2** | 前端骨架：`features/dashboard/*` + `card registry` + `EXECUTIVE` / `MANAGER` / `EMPLOYEE` 三套布局（全部复用现有接口） | 桌面端 | 2–3 天 |
| **P3** | 快照表 + 聚合服务 + `/dashboard/trends` + `echarts` 图形 | API + 前端 | 2–3 天 |
| **P4** | 财务域：收支台账模型 + 导入 + 权限位 + `FINANCE` 卡片组 + 上传页 | API + 前端 | 3–4 天 |
| **P5** | 法务域：`LEGAL` 卡片组（纯现有表，无迁移） | API + 前端 | 1–2 天 |
| **P6** | 经营层 `/dashboard/executive` + 异常规则 + AI 解读卡 | API + 前端 | 2–3 天 |
| **P7** | `HR` 域（需工作日历）、用户自定义布局 | 待定 | — |

**建议顺序**：P1 → P2 → P5（法务最快见效）→ P3 → P4（财务最重）→ P6。

P1 必须先做，否则 P3 之后的趋势与经营层视图都建立在错误的数据范围之上。

## 14. 未决事项

| # | 事项 | 待定内容 |
| --- | --- | --- |
| 1 | 快照触发方式 | 引入 `@nestjs/schedule`（方案 A）还是外部 cron 调管理端点（方案 B，推荐） |
| 2 | Excel 解析依赖 | 新增 `exceljs` / `xlsx`（推荐）还是仅支持 CSV 手写解析 |
| 3 | 收支台账科目 | 沿用收入/支出对方科目自由文本，还是新建租户级科目表（建议先自由文本 + 后续归一） |
| 4 | 异常阈值配置 | 落在 `tenants` 扩展字段、独立配置表，还是先硬编码后端常量（建议独立配置表） |
| 5 | 前端解析还是后端解析上传文件 | 建议复用组织成员导入的"前端解析 + 后端校验 JSON"模式 |
| 6 | 旧 `HomePage` 是否保留入口 | 建议直接替换，不做双首页切换 |
| 7 | 工作日历 | 引入最小工作日历表的时间点（影响 `HR` 域与日报提交率分母） |

## 15. 契约、实现与验证

- 公开契约：`packages/contracts/openapi/openapi.yaml`；
- 功能文档：本文档；
- 相关现有文档：`docs/product/dashboard-workbench.md`、`docs/product/assignment-and-hr-finance-legal.md`、`docs/product/organization-member-import.md`；
- 计划新增实现：
  - API：`apps/api/src/dashboard/*`（扩展）、`apps/api/src/finance/ledger/*`（新增）；
  - 权限目录：`apps/api/src/rbac/permission-catalog.ts`；
  - 迁移：`tasks.completed_at`、`dashboard_metric_snapshots`、`finance_ledger_imports`、`finance_ledger_entries`；
  - 桌面端：`apps/desktop/src/features/dashboard/*`。

验证命令：

```bash
# API 受影响模块
pnpm --filter @cees/api test -- dashboard task finance legal

# 契约校验与客户端重新生成
pnpm contracts:check
pnpm contracts:gen

# 桌面端
pnpm --filter @cees/desktop exec tsc -b
pnpm --filter @cees/desktop run build
```

验收基线（至少覆盖）：

- 无 `dashboard.read` 权限的成员无法访问任何首页接口；
- 仅 `task.read` 的成员只能看到执行层骨架，且财务/法务卡片不出现；
- `dataScope = TENANT` 但无 `project.manage_all` 的角色，首页项目与任务统计与业务模块列表页数字一致；
- 财务专员与法务专员在同等权限配置下拿到**不同的** `archetype.skeleton` / `domains` / `cards`；
- 昨日、上月口径在非 `Asia/Shanghai` 租户时区下仍正确；
- 重复上传同一批台账不产生重复数据，`skippedCount` 正确。
