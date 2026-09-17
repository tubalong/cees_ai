# Legal 合同台账设计

> 状态：契约已冻结，API、Prisma 与 Desktop 待实现
> Owner：C
> 契约版本：`0.28.0`
> 更新日期：2026-09-17
> 关联：`packages/contracts/openapi/openapi.yaml`、[人财法数据契约](hr-finance-legal-data-contract.md)、[分配策略与人财法 API](../api/assignment-and-hr-finance-legal-api.md)

## 1. 目标

Legal 合同台账为租户提供合同登记、归属、附件、状态跟踪、到期管理和只读经营聚合能力。NestJS API 是正式合同数据的唯一事实源，Desktop 只通过公开契约读写，不复制状态机。

本期完成后应满足：

- 合同按租户隔离，合同编号在租户内唯一。
- 合同负责人、业务部门和项目归属可用于角色数据范围过滤。
- 合同正文或扫描件通过现有 `FileObject` 关联，不复制文件存储能力。
- 合同状态只能通过明确动作流转，并保留状态历史和审计事件。
- 支持即将到期、待续签、已到期合同查询和汇总。
- 为 B 的老板经营概况提供生效合同数和即将到期合同数。

## 2. 本期边界

### 2.1 包含

- 合同台账 CRUD。
- 合同自动编号与手工编号。
- 负责人、部门、项目和交易对方信息。
- 合同金额、币种、签署日期、生效日期和到期日期。
- 合同附件。
- 激活、待续签、续签、到期、终止和归档状态流转。
- 状态历史、操作审计、软删除和乐观锁。
- 列表筛选、到期窗口和合同汇总。
- Desktop 合同列表、详情、编辑、状态操作和到期概览。

### 2.2 不包含

- 法务审批流、用印审批和会签。
- 电子签章、第三方签约平台和合同正文在线编辑。
- AI 条款审查、风险评分和自动修改正式合同。
- 付款计划、收款核销、发票和总账写入。
- 交易对方主数据中心。
- 合同变更协议、合同模板和复杂版本树。

AI 后续只能生成合同草稿或风险建议；正式合同台账仍由 NestJS API 写入。

## 3. 领域模型

实现阶段计划增加以下 Prisma 模型，数据库结构只通过提交入库的 Prisma migration 演进。

### 3.1 `LegalContract`

| 字段 | 规则 |
| --- | --- |
| `tenantId` | 所有查询和写入必须携带当前租户 |
| `contractNo` | 当前租户内唯一；允许手工传入或服务端生成 |
| `name` | 合同名称，1～160 字符 |
| `counterparty` | 交易对方展示名称，1～160 字符 |
| `type` | `PURCHASE/SALES/SERVICE/EMPLOYMENT/NDA/LEASE/OTHER` |
| `amount` | 可空，非负，数据库使用 `DECIMAL(18,2)` |
| `currency` | 三位大写币种代码，默认 `CNY` |
| `startDate` | 合同生效日期 |
| `endDate` | 可空；无固定期限合同不填写 |
| `signedAt` | 可空；激活前必须填写 |
| `ownerMembershipId` | 必填，必须是当前租户有效成员 |
| `departmentId` | 可空，保存合同业务归属部门，不随负责人调岗自动变化 |
| `projectId` | 可空，必须是当前租户未删除项目 |
| `renewalReminderDays` | 到期提醒提前天数，默认 30，范围 0～365 |
| `status` | 新建固定为 `DRAFT`，不能通过普通 PATCH 修改 |
| `version` | 从 1 开始，每次写入递增 |
| `deletedAt` | 软删除标记，仅 `DRAFT` 可删除 |

日期约束：

- `endDate` 不为空时必须大于或等于 `startDate`。
- 续签后的 `newEndDate` 必须晚于原 `endDate`；原 `endDate` 为空时不得执行续签动作。
- 终止日期不得早于 `startDate`，也不得晚于服务端受理日期。
- 所有“今天”按租户时区换算，禁止直接使用数据库 UTC 日期判断业务到期。

### 3.2 `LegalContractAttachment`

- 关联 `contractId` 与现有 `FileObject`。
- 一个合同最多关联 20 个文件。
- 文件必须属于当前租户，且用途允许作为业务附件。
- 同一合同不能重复关联同一个 `fileObjectId`。
- 删除合同只软删除合同；附件关联由实现按事务处理，`FileObject` 不级联物理删除。

### 3.3 `LegalContractStatusHistory`

每次创建和状态变化写入一条历史：

- `fromStatus`
- `toStatus`
- `actorMembershipId`，系统自动流转时为 `null`
- `comment`
- `createdAt`

历史记录不可修改和删除。创建合同时写入 `null -> DRAFT`。

### 3.4 `LegalContractSequence`

服务端自动编号按“租户 + 年份”维护序列，建议格式：

```text
HT-{YYYY}-{6位流水号}
```

示例：`HT-2026-000001`。自动编号必须在数据库事务中生成；手工编号与自动编号共用租户唯一约束，冲突返回 `409`。

## 4. 状态机

| 当前状态 | 允许动作 | 目标状态 | 关键校验 |
| --- | --- | --- | --- |
| `DRAFT` | 激活 | `ACTIVE` | `signedAt` 已填写，负责人及关联资源有效 |
| `DRAFT` | 删除 | 软删除 | 需要 `legal.contract.delete` 和正确 `version` |
| `ACTIVE` | 标记待续签 | `PENDING_RENEWAL` | 必须存在 `endDate` |
| `ACTIVE` | 自动到期 | `EXPIRED` | 租户日期已经超过 `endDate` |
| `ACTIVE` | 终止 | `TERMINATED` | 必须填写终止日期和原因 |
| `PENDING_RENEWAL` | 续签 | `ACTIVE` | 新到期日期晚于原到期日期 |
| `PENDING_RENEWAL` | 自动到期 | `EXPIRED` | 租户日期已经超过 `endDate` |
| `PENDING_RENEWAL` | 终止 | `TERMINATED` | 必须填写终止日期和原因 |
| `EXPIRED` | 续签 | `ACTIVE` | 新到期日期晚于原到期日期 |
| `EXPIRED` | 归档 | `ARCHIVED` | 记录归档操作者和备注 |
| `TERMINATED` | 归档 | `ARCHIVED` | 记录归档操作者和备注 |
| `ARCHIVED` | 无 | — | 终态，只读 |

普通 `PATCH /legal/contracts/{contractId}` 不接收 `status`。状态变化必须通过动作接口完成，并在同一事务中更新合同、写状态历史和审计事件。

实现阶段的后台任务每天按租户时区执行：

- `ACTIVE` 合同进入提醒窗口时变为 `PENDING_RENEWAL`。
- `ACTIVE` 或 `PENDING_RENEWAL` 合同超过 `endDate` 后变为 `EXPIRED`。
- 自动变化也必须写状态历史和系统审计，操作者使用系统身份或明确的系统元数据。

## 5. 修改规则

- `DRAFT`：允许修改全部非状态字段。
- `ACTIVE`、`PENDING_RENEWAL`：允许修改名称、对方、描述、负责人、部门、项目、附件和提醒天数；金额、币种、生效日期、签署日期和到期日期不可直接修改。
- 到期日期延长必须使用续签接口，确保留下状态历史。
- `EXPIRED`、`TERMINATED`、`ARCHIVED`：普通 PATCH 拒绝；只允许执行状态机中列出的动作。
- 负责人、部门、项目和附件变更均需重新校验租户归属。
- 所有修改必须携带 `version`，版本不一致返回 `409`。

## 6. 权限与数据范围

### 6.1 权限码

| 权限 | 能力 |
| --- | --- |
| `legal.contract.read` | 查询合同、详情、状态历史和汇总 |
| `legal.contract.create` | 创建草稿合同 |
| `legal.contract.update` | 修改数据范围内合同并执行状态动作 |
| `legal.contract.delete` | 删除数据范围内草稿合同 |
| `legal.contract.manage_all` | 与对应操作权限组合使用，绕过普通数据范围 |

`manage_all` 不单独授予读取、创建、修改或删除能力；调用者仍需具备接口要求的对应操作权限。它只放宽当前租户内的数据范围，不绕过状态机、乐观锁或租户校验。

### 6.2 数据范围映射

服务端统一调用 `DataScopeResolverService`：

- `SELF`：`ownerMembershipId` 为当前成员。
- `DEPARTMENT` / `DEPARTMENT_TREE`：`departmentId` 位于可见部门集合。
- `PROJECT`：`projectId` 位于当前成员参与项目集合。
- 多个范围取并集。
- `TENANT` 或 `legal.contract.manage_all`：当前租户全部合同。

合同没有 `departmentId` 或 `projectId` 时，不因负责人当前部门或项目变化自动获得对应范围；仍可通过 `SELF`、`TENANT` 或 `manage_all` 访问。

创建或修改归属字段时，调用者只能选择其数据范围内的负责人、部门和项目；`manage_all` 可选择当前租户任意有效资源。

## 7. API 契约

### 7.1 台账与详情

```text
GET    /api/v1/legal/contracts
POST   /api/v1/legal/contracts
GET    /api/v1/legal/contracts/{contractId}
PATCH  /api/v1/legal/contracts/{contractId}
DELETE /api/v1/legal/contracts/{contractId}?version={version}
```

列表支持：`keyword`、`status`、`type`、`ownerMembershipId`、`departmentId`、`projectId`、`currency`、`endDateFrom`、`endDateTo`、`expiringWithinDays`、`limit`、`cursor`。

- `keyword` 匹配合同编号、名称和交易对方。
- 默认排序为 `updatedAt DESC, id DESC`，游标必须保持稳定排序。
- `expiringWithinDays` 仅匹配存在 `endDate` 且状态为 `ACTIVE` 或 `PENDING_RENEWAL` 的合同。
- 创建时未传 `contractNo` 则服务端自动编号；创建状态固定为 `DRAFT`。

### 7.2 状态动作

```text
POST /api/v1/legal/contracts/{contractId}/activate
POST /api/v1/legal/contracts/{contractId}/mark-pending-renewal
POST /api/v1/legal/contracts/{contractId}/renew
POST /api/v1/legal/contracts/{contractId}/terminate
POST /api/v1/legal/contracts/{contractId}/archive
```

所有动作必须携带 `version`。续签必须携带 `newEndDate`；终止必须携带 `effectiveDate` 和 `reason`。

### 7.3 汇总

```text
GET /api/v1/legal/reports/contract-summary
```

参数：

- `asOf`：可选，默认当前租户日期。
- `expiringWithinDays`：默认 30，范围 1～365。

汇总应用与列表相同的数据范围，返回各状态数量、到期窗口数量，以及按币种分组的生效合同金额和即将到期合同金额。不同币种不得直接求和。

## 8. 附件与文件安全

- 客户端先通过现有文件上传能力获得 `FileObject.id`，再将 `attachmentIds` 传给合同接口。
- 合同响应只返回文件元数据，不返回长期公开 URL。
- 下载地址继续由现有文件访问接口按权限临时签发。
- 服务端必须校验附件租户、用途、删除状态和数量上限。
- 合同访问者只有在同时具备合同数据范围时才能获取附件下载能力。

## 9. 审计

至少记录以下事件：

```text
LEGAL_CONTRACT_CREATED
LEGAL_CONTRACT_UPDATED
LEGAL_CONTRACT_ACTIVATED
LEGAL_CONTRACT_PENDING_RENEWAL
LEGAL_CONTRACT_RENEWED
LEGAL_CONTRACT_EXPIRED
LEGAL_CONTRACT_TERMINATED
LEGAL_CONTRACT_ARCHIVED
LEGAL_CONTRACT_DELETED
```

审计事件必须包含：租户、操作者、请求 ID、合同 ID、原状态、目标状态、版本和必要扩展元数据。失败操作沿用全局异常审计策略，不把敏感合同正文写入审计 metadata。

## 10. 老板经营概况

B 的老板经营概况通过 Legal 应用服务的只读聚合方法消费：

- `activeContractCount`：状态为 `ACTIVE` 的合同数量。
- `expiringContractCount`：状态为 `ACTIVE` 或 `PENDING_RENEWAL`，且 `endDate` 位于默认 30 天窗口内的合同数量。

老板经营概况模块不得直接修改 Legal 表，也不得绕过 Legal 数据范围和租户过滤。聚合窗口需要与 `/legal/reports/contract-summary` 保持一致。

## 11. Desktop 页面

页面目录：`apps/desktop/src/features/legal/**`。

最小页面能力：

- 状态概览卡片：生效、待续签、即将到期、已到期。
- 合同列表、组合筛选和游标加载。
- 新建和编辑草稿。
- 合同详情、附件和状态历史。
- 激活、标记待续签、续签、终止、归档和删除操作。
- 根据 `legal.contract.*` 控制页面入口和按钮。
- `409` 时提示数据已变化并重新加载最新合同。

导航与路由位于 B 负责的 `apps/desktop/src/app/**`。C 实现 feature 页面后，由壳层 owner 接入 `/legal`；如果在同一 PR 修改壳层文件，需要 B owner 评审。

## 12. 失败语义

| HTTP | 场景 |
| --- | --- |
| `400` | 字段、日期、附件或关联资源校验失败 |
| `401` | 登录状态无效或已过期 |
| `403` | 缺少权限或超出数据范围 |
| `404` | 合同不存在、已删除或不属于当前租户 |
| `409` | 合同编号、状态或乐观锁版本冲突 |

不向调用者区分“其他租户合同”和“不存在合同”，避免资源枚举。

## 13. 兼容与迁移说明

公开契约从 `0.27.0` 提升至 `0.28.0`。Legal 尚未部署正式 API，本次在实现前冻结契约，但生成客户端存在类型变化：

- `CreateLegalContractRequest.type` 和 `ownerMembershipId` 改为必填。
- 创建请求不再允许直接指定 `status`，新建状态固定为 `DRAFT`。
- `endDate` 改为可空，支持无固定期限合同。
- 响应新增归属、附件、状态历史和生命周期字段。
- 新增状态动作与汇总接口。

实现分支必须新增 Prisma migration，并在数据库文档中链接实际 migration 名称。由于当前没有 Legal 正式表和生产数据，本次不需要历史数据回填；若实现前发现外部调用已依赖旧草案，必须先完成调用方兼容调整。

## 14. 验收基线

- OpenAPI lint、客户端生成和生成物检查通过。
- Prisma migration、schema validation 和 API build 通过。
- Jest 覆盖租户隔离、数据范围、状态机、附件校验、编号冲突、乐观锁和审计。
- Desktop TypeScript 检查和生产构建通过。
- 状态动作不能通过普通 PATCH 绕过。
- 老板经营概况与 Legal 汇总对“即将到期”的定义一致。
- 代码、契约、生成客户端和本文档状态保持一致。
