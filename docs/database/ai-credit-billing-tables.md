# AI Credit 计费配置表结构设计草案

> 状态：**已评审通过（S1 完成），并已落地 Prisma schema 与 migration `20260923070447_ai_credit_billing_config`（S2 完成）、初始数据 seed（S3 完成，`prisma/ai-credit-billing.seed.ts`）、配置接口契约（S5 完成，`openapi.yaml` 0.40.0 的 `/platform/ai-credit/*` 共 21 个操作）、能力目录管理接口（S6 完成，`platform-ai-credit` 模块 5 端点 + 权限码 `platform.aiCredit.read/write`）、档位管理接口（S7 完成，tiers 5 端点：功能集只接受功能开关类能力、价格 duration 唯一、乐观锁 version、软删除）**。鉴权复用现有 PlatformJwtAuthGuard（无独立 S4）；下一步 S8（费率表管理）。
> 范围：第一阶段「超级管理员配置模块」所需的全部表。企业购买、企业池、结算扣减、限额等表属后续阶段（A3/A4/A5/B 系列），**本阶段不建**。
> 规则来源：docs/product/ai-credit-system-design.md 与 docs/product/ai-credit-implementation-checklist.md。

## 一、设计概览

- 共 **7 张新表 + 5 个新枚举**，全部为**平台级配置**（无 tenantId，不挂租户）；
- 命名沿用现有习惯：模型 PascalCase、表名 `@@map` 蛇形复数、字段 `@map` 蛇形、UUID 主键、公共字段 `createdAt/updatedAt/createdBy/updatedBy/deletedAt/version`（乐观锁）；
- 金额/credit 精度 `@db.Decimal(18,2)`（覆盖最小单位 0.1 credit 与常见价格）；倍率/比例 `@db.Decimal(10,4)`（支持 0.5、1.5 等倍率）；
- **档位权限码机制**：档位码 = `AICreditTier.code`（配置值），其"展开集合" = 该档位在 `AICreditTierCapability` 中关联的能力的 `permissionCode`。功能集勾选变动 → 集合随配置自动变动，无需单独维护（满足"档位码可配置、跟随档位功能变动"）。

## 二、新枚举

| 枚举 | 值 | 用途 |
| --- | --- | --- |
| AICreditConfigStatus | ACTIVE / INACTIVE | 配置项上下架 |
| AICreditMeterType | TOKEN / PER_REQUEST | 能力的计量类型 |
| AICreditCapabilityKind | TIER_GATED / UNIVERSAL | 功能开关类（参与档位差异化）/ 通用类（全档开放，仅计费差异化） |
| AICreditRateDimension | TOKEN_INPUT / TOKEN_OUTPUT / PER_REQUEST | 费率表的计量维度（输入/输出分开、按次） |
| AICreditSubscriptionDuration | ONE_MONTH / SIX_MONTHS / TWELVE_MONTHS | 订阅持续时间 |

## 三、表设计

### 1. ai_credit_capabilities（能力目录）

对应 S6。平台级枚举所有可计费能力。

| 字段 | 类型 | 约束/说明 |
| --- | --- | --- |
| id | String @db.Uuid | 主键 |
| code | String | 能力 code（chat / rag / image-gen / doc-gen / pdf-gen / ppt-gen / workflow / web-search / tool-calling）；唯一性由迁移手写的部分唯一索引保证（`WHERE deleted_at IS NULL`，软删除后允许重建）；通用能力（chat / tool-calling / web-search）全档开放、不参与档位功能集 |
| name | String | 显示名 |
| description | String? | — |
| meterType | AICreditMeterType | @default(TOKEN) |
| capabilityKind | AICreditCapabilityKind | @default(TIER_GATED) |
| permissionCode | String? | **映射现有 permissions.code**（能力 code ↔ 权限码的桥）；通用能力也配置对应权限码，可空表示无需权限。现有可映射码：rag→`knowledge_base.query`、image-gen→`ai.image.generate`、doc-gen→`ai.document.generate`、web-search→`ai.web.search`；chat、tool-calling 现有目录无独立码（对话工具集默认可用）→ 留空；pdf-gen/ppt-gen/workflow 的权限码已随 S3 seed 在 permissions 表注册 |
| sortOrder | Int | @default(0)，后台排序 |
| status | AICreditConfigStatus | @default(ACTIVE) |
| 公共字段 | — | createdAt/updatedAt/createdBy/updatedBy/deletedAt/version |

索引：`@@index([status, sortOrder])`；`code` 的唯一性由迁移手写的部分唯一索引保证（`WHERE deleted_at IS NULL`，软删除后允许重建）。

### 2. ai_credit_tiers（档位）

对应 S7。`code` 即**档位权限码**（如 `TIER_BASIC` / `TIER_PREMIUM`），实现阶段在 permissions 表注册同 code 的权限码行后，租户订阅即持有该集合码（后续阶段落地）。

| 字段 | 类型 | 约束/说明 |
| --- | --- | --- |
| id | String @db.Uuid | 主键 |
| code | String | 档位 code，兼作档位权限码值；唯一性由迁移手写的部分唯一索引保证（`WHERE deleted_at IS NULL`，软删除后允许重建） |
| name | String | 显示名（基础版/高级版） |
| description | String? | — |
| monthlyBaseCredits | Decimal @db.Decimal(18,2) | **每订阅单位基础额度**（订阅单位倍率）；seed 初值：基础版 5,000 / 高级版 10,000（每档各填本档值） |
| status | AICreditConfigStatus | @default(ACTIVE)，下架档不可再购 |
| prices | AICreditTierPrice[] | 各持续时间价格 |
| capabilities | AICreditTierCapability[] | 功能集 |
| 公共字段 | — | createdAt/updatedAt/createdBy/updatedBy/deletedAt/version |

### 3. ai_credit_tier_prices（档位价格）

档位价格与单位单价按持续时间分别配置（每档 × 每持续时间一行）。

| 字段 | 类型 | 约束/说明 |
| --- | --- | --- |
| id | String @db.Uuid | 主键 |
| tierId | String @db.Uuid | 外键 → ai_credit_tiers |
| duration | AICreditSubscriptionDuration | 订阅持续时间 |
| tierPrice | Decimal @db.Decimal(18,2) | **档位价格**（该持续时间） |
| unitPrice | Decimal @db.Decimal(18,2) | **单位单价**（该持续时间） |
| createdAt / updatedAt | DateTime | — |

约束：`@@unique([tierId, duration])`。订阅总价 = `(tierPrice + unitPrice × N) × 折扣`（折扣在全局配置）。

### 4. ai_credit_tier_capabilities（档位-能力关联）

功能集勾选关系；只关联**功能开关类**能力（通用能力全档开放、不写此表）。

| 字段 | 类型 | 约束/说明 |
| --- | --- | --- |
| id | String @db.Uuid | 主键 |
| tierId | String @db.Uuid | 外键 → ai_credit_tiers |
| capabilityId | String @db.Uuid | 外键 → ai_credit_capabilities |
| createdAt | DateTime | — |

约束：`@@unique([tierId, capabilityId])`；`@@index([capabilityId])`。

### 5. ai_credit_rate_cards（费率表，含版本）

对应 S8。维度：能力 × 模型组 × 计量维度。**版本化：调价 = 插入新 version 行，历史版本行保留不删除，账目不追溯历史**。

| 字段 | 类型 | 约束/说明 |
| --- | --- | --- |
| id | String @db.Uuid | 主键 |
| capabilityId | String @db.Uuid | 外键 → ai_credit_capabilities |
| modelGroup | String | @default("default")；模型组维度，初始统一 "default"，模型池丰富后再分 |
| dimension | AICreditRateDimension | TOKEN_INPUT / TOKEN_OUTPUT / PER_REQUEST |
| tokenMultiplier | Decimal? @db.Decimal(10,4) | **token 倍率**（上游 token → 计费 token），初始 1；仅 TOKEN 维度填写（输入/输出各自独立配置） |
| creditPerToken | Decimal? @db.Decimal(10,4) | **token→credit 比例**（计费 token → credit），初始 1；仅 TOKEN 维度填写（输入/输出各自独立配置） |
| perRequestCredits | Decimal? @db.Decimal(18,2) | **按次 credit**，仅 PER_REQUEST 维度填写（图像 500 / 文档 800 / PDF 500 / PPT 1000） |
| rateVersion | Int | @default(1)；**业务版本号**（调价新增版本行），与公共字段乐观锁 `version` 区分，命名 `rateVersion` |
| status | AICreditConfigStatus | @default(ACTIVE) |
| 公共字段 | — | createdAt/updatedAt/createdBy/updatedBy/deletedAt/version（乐观锁） |

约束：`@@unique([capabilityId, modelGroup, dimension, rateVersion])`；`@@index([capabilityId, modelGroup, dimension])`。
有效性判定（应用层）：取该组合 `status=ACTIVE` 且 `rateVersion` 最大的行；无有效行 → **拒绝结算**（rejectUnconfiguredRate）。维度对应字段必填由应用层校验。

### 6. ai_credit_booster_tiers（加油包档位）

对应 S10。

| 字段 | 类型 | 约束/说明 |
| --- | --- | --- |
| id | String @db.Uuid | 主键 |
| name | String | 显示名 |
| credits | Decimal @db.Decimal(18,2) | 额度（5,000 / 10,000 / 50,000） |
| price | Decimal @db.Decimal(18,2) | 价格（商务值上线前填） |
| description | String? | — |
| status | AICreditConfigStatus | @default(ACTIVE) |
| 公共字段 | — | createdAt/updatedAt/createdBy/updatedBy/deletedAt/version |

> 永久有效：不设有效期字段（策略已定"永久有效"）。

### 7. ai_credit_billing_configs（全局计费配置，单行表）

合并 S9（订阅参数）与 S11（全局计费配置）。单行表，固定主键 `"default"`。

| 字段 | 类型 | 默认/说明 |
| --- | --- | --- |
| id | String @id | 固定 "default" |
| minCreditUnit | Decimal @db.Decimal(4,1) | @default(0.1)；最小计量单位 |
| resetDay | Int | @default(1)；每月重置日（企业本地时区） |
| resetTimezoneMode | String | @default("TENANT_LOCAL")；重置时区模式（已定企业本地时区，值预留扩展） |
| rejectUnconfiguredRate | Boolean | @default(true)；未配置费率一律拒绝 |
| subscriptionDurations | AICreditSubscriptionDuration[] | seed 填 [ONE_MONTH, SIX_MONTHS, TWELVE_MONTHS]；可配置的持续时间选项 |
| halfYearlyDiscountRate | Decimal @db.Decimal(4,2) | @default(0.90)；半年 9 折 |
| yearlyDiscountRate | Decimal @db.Decimal(4,2) | @default(0.80)；一年 8 折 |
| maxSubscriptionUnits | Int | @default(500)；订阅单位数量上限 |
| updatedAt / updatedBy / version | — | 单行表公共字段（无 createdAt/deletedAt） |

## 四、与现有表的衔接（本阶段只读/引用，不改动）

| 现有表 | 衔接方式 |
| --- | --- |
| Tenant.timezone | 额度重置时区取企业本地时区（后续 A3 使用） |
| Permission | 能力 code 通过 `AICreditCapability.permissionCode` 映射（现有码：rag→`knowledge_base.query`、image-gen→`ai.image.generate`、doc-gen→`ai.document.generate`、web-search→`ai.web.search`）；pdf-gen/ppt-gen/workflow 的权限码已随 S3 seed 注册；档位码（如 TIER_PREMIUM）同样在 permissions 表注册同 code 行（后续订阅阶段 A4 落地，S7 只做档位配置管理） |
| PlatformAdministrator | 超级管理员身份（S4 守卫复用） |
| AIInvocationLog | 结算事实源（A5，本阶段不涉及） |
| PlatformAuditLog | 配置操作的审计（S6 能力目录、S7 档位管理已写入平台审计：创建/修改/删除事件） |

## 五、本阶段明确不建（预留）

- **订单表**（A4 阶段建）：预留支付字段（渠道/状态/金额），支付系统后续接入；
- 企业池余额与扣减流水（A3）、订阅记录（A4）、成员限额（B1）——后续阶段。

## 六、待评审决策点

1. 费率表采用**单表 + rateVersion 唯一约束**（非 card/version 双表），简单且满足"调价不追溯历史"——是否认可；
2. 档位价格与单位单价拆独立子表 `ai_credit_tier_prices`（每档 × 每持续时间一行）——是否认可；
3. S9 + S11 合并为单行配置表 `ai_credit_billing_configs`——是否认可；
4. 全局配置表的 `subscriptionDurations` 用 enum 数组存（Postgres 标量列表）——是否认可；
5. 配置表沿用项目惯例软删除（deletedAt）；`code` 唯一约束采用**部分唯一索引（`WHERE deleted_at IS NULL`）**——沿用 assignment_policies 先例，软删除后可直接重建同 code，无需复活旧行；下架优先用 status=INACTIVE（主路径）。已按此落地（20260923071550_ai_credit_billing_config_refine）。
