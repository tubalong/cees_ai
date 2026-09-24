-- DropIndex
DROP INDEX "ai_credit_capabilities_code_key";

-- DropIndex
DROP INDEX "ai_credit_tiers_code_key";

-- CreateIndex
-- code 唯一性改为部分唯一索引（WHERE deleted_at IS NULL）：
-- 软删除后允许重建同 code，与 assignment_policies 的部分唯一索引先例一致。
CREATE UNIQUE INDEX "ai_credit_capabilities_code_key" ON "ai_credit_capabilities"("code") WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "ai_credit_tiers_code_key" ON "ai_credit_tiers"("code") WHERE "deleted_at" IS NULL;

-- 补齐 AI Credit 计费配置各表与字段的 PostgreSQL 注释。
COMMENT ON TABLE "ai_credit_capabilities" IS '平台级 AI 计费能力目录；能力 code 通过 permission_code 桥接现有权限码，供档位功能集与费率表引用。';
COMMENT ON COLUMN "ai_credit_capabilities"."code" IS '能力 code（chat / rag / image-gen / doc-gen / pdf-gen / ppt-gen / workflow）；部分唯一索引保证未删除记录不重复。';
COMMENT ON COLUMN "ai_credit_capabilities"."name" IS '能力显示名。';
COMMENT ON COLUMN "ai_credit_capabilities"."description" IS '能力说明。';
COMMENT ON COLUMN "ai_credit_capabilities"."meter_type" IS '计量类型：TOKEN 按 token、PER_REQUEST 按次。';
COMMENT ON COLUMN "ai_credit_capabilities"."capability_kind" IS '能力类型：TIER_GATED 功能开关类（参与档位差异化）、UNIVERSAL 通用类（全档开放仅计费差异化）。';
COMMENT ON COLUMN "ai_credit_capabilities"."permission_code" IS '映射现有 permissions.code；通用能力留空表示无需权限。';
COMMENT ON COLUMN "ai_credit_capabilities"."sort_order" IS '后台列表排序。';
COMMENT ON COLUMN "ai_credit_capabilities"."status" IS '上下架状态：ACTIVE 上架、INACTIVE 下架。';
COMMENT ON COLUMN "ai_credit_capabilities"."created_at" IS '创建时间。';
COMMENT ON COLUMN "ai_credit_capabilities"."updated_at" IS '更新时间。';
COMMENT ON COLUMN "ai_credit_capabilities"."created_by" IS '创建人用户 ID。';
COMMENT ON COLUMN "ai_credit_capabilities"."updated_by" IS '更新人用户 ID。';
COMMENT ON COLUMN "ai_credit_capabilities"."deleted_at" IS '软删除时间；为空表示未删除。';
COMMENT ON COLUMN "ai_credit_capabilities"."version" IS '乐观锁版本。';

COMMENT ON TABLE "ai_credit_tiers" IS 'AI 订阅档位；code 兼作档位权限码，保存每订阅单位基础额度（订阅单位倍率），功能集与价格关联子表。';
COMMENT ON COLUMN "ai_credit_tiers"."code" IS '档位 code，兼作档位权限码值（如 TIER_BASIC / TIER_PREMIUM）；部分唯一索引保证未删除记录不重复。';
COMMENT ON COLUMN "ai_credit_tiers"."name" IS '档位显示名（基础版/高级版）。';
COMMENT ON COLUMN "ai_credit_tiers"."description" IS '档位说明。';
COMMENT ON COLUMN "ai_credit_tiers"."monthly_base_credits" IS '每订阅单位基础额度（订阅单位倍率）。';
COMMENT ON COLUMN "ai_credit_tiers"."status" IS '上下架状态：ACTIVE 上架、INACTIVE 下架（下架档不可再购）。';
COMMENT ON COLUMN "ai_credit_tiers"."created_at" IS '创建时间。';
COMMENT ON COLUMN "ai_credit_tiers"."updated_at" IS '更新时间。';
COMMENT ON COLUMN "ai_credit_tiers"."created_by" IS '创建人用户 ID。';
COMMENT ON COLUMN "ai_credit_tiers"."updated_by" IS '更新人用户 ID。';
COMMENT ON COLUMN "ai_credit_tiers"."deleted_at" IS '软删除时间；为空表示未删除。';
COMMENT ON COLUMN "ai_credit_tiers"."version" IS '乐观锁版本。';

COMMENT ON TABLE "ai_credit_tier_prices" IS '档位价格与单位单价，按订阅持续时间分别配置；订阅总价 = (档位价格 + 单位单价 × 订阅单位数) × 折扣。';
COMMENT ON COLUMN "ai_credit_tier_prices"."tier_id" IS '档位外键。';
COMMENT ON COLUMN "ai_credit_tier_prices"."duration" IS '订阅持续时间（一个月/半年/一年）。';
COMMENT ON COLUMN "ai_credit_tier_prices"."tier_price" IS '档位价格（该持续时间）。';
COMMENT ON COLUMN "ai_credit_tier_prices"."unit_price" IS '单位单价（该持续时间）。';
COMMENT ON COLUMN "ai_credit_tier_prices"."created_at" IS '创建时间。';
COMMENT ON COLUMN "ai_credit_tier_prices"."updated_at" IS '更新时间。';

COMMENT ON TABLE "ai_credit_tier_capabilities" IS '档位功能集勾选关系，只关联功能开关类能力；通用能力全档开放、不写入本表。';
COMMENT ON COLUMN "ai_credit_tier_capabilities"."tier_id" IS '档位外键。';
COMMENT ON COLUMN "ai_credit_tier_capabilities"."capability_id" IS '能力外键（仅功能开关类能力）。';
COMMENT ON COLUMN "ai_credit_tier_capabilities"."created_at" IS '创建时间。';

COMMENT ON TABLE "ai_credit_rate_cards" IS 'AI 计费费率表：能力 × 模型组 × 计量维度；调价插入新 rate_version 行，历史版本保留不删除、账目不追溯历史。';
COMMENT ON COLUMN "ai_credit_rate_cards"."capability_id" IS '能力外键。';
COMMENT ON COLUMN "ai_credit_rate_cards"."model_group" IS '模型组维度；初始统一 default，模型池丰富后再分。';
COMMENT ON COLUMN "ai_credit_rate_cards"."dimension" IS '计量维度：TOKEN_INPUT 输入 token、TOKEN_OUTPUT 输出 token、PER_REQUEST 按次。';
COMMENT ON COLUMN "ai_credit_rate_cards"."token_multiplier" IS 'token 倍率（上游 token → 计费 token）；仅 TOKEN 维度填写。';
COMMENT ON COLUMN "ai_credit_rate_cards"."credit_per_token" IS 'token→credit 比例（计费 token → credit）；仅 TOKEN 维度填写。';
COMMENT ON COLUMN "ai_credit_rate_cards"."per_request_credits" IS '按次 credit；仅 PER_REQUEST 维度填写。';
COMMENT ON COLUMN "ai_credit_rate_cards"."rate_version" IS '业务版本号（调价新增版本行），与公共字段乐观锁 version 区分。';
COMMENT ON COLUMN "ai_credit_rate_cards"."status" IS '上下架状态；结算只取 ACTIVE 且 rate_version 最大的行。';
COMMENT ON COLUMN "ai_credit_rate_cards"."created_at" IS '创建时间。';
COMMENT ON COLUMN "ai_credit_rate_cards"."updated_at" IS '更新时间。';
COMMENT ON COLUMN "ai_credit_rate_cards"."created_by" IS '创建人用户 ID。';
COMMENT ON COLUMN "ai_credit_rate_cards"."updated_by" IS '更新人用户 ID。';
COMMENT ON COLUMN "ai_credit_rate_cards"."deleted_at" IS '软删除时间；为空表示未删除。';
COMMENT ON COLUMN "ai_credit_rate_cards"."version" IS '乐观锁版本。';

COMMENT ON TABLE "ai_credit_booster_tiers" IS '加油包档位；永久有效，不设有效期字段。';
COMMENT ON COLUMN "ai_credit_booster_tiers"."name" IS '加油包显示名。';
COMMENT ON COLUMN "ai_credit_booster_tiers"."credits" IS '加油包额度。';
COMMENT ON COLUMN "ai_credit_booster_tiers"."price" IS '加油包价格。';
COMMENT ON COLUMN "ai_credit_booster_tiers"."description" IS '加油包说明。';
COMMENT ON COLUMN "ai_credit_booster_tiers"."status" IS '上下架状态：ACTIVE 上架、INACTIVE 下架（下架档不可再购）。';
COMMENT ON COLUMN "ai_credit_booster_tiers"."created_at" IS '创建时间。';
COMMENT ON COLUMN "ai_credit_booster_tiers"."updated_at" IS '更新时间。';
COMMENT ON COLUMN "ai_credit_booster_tiers"."created_by" IS '创建人用户 ID。';
COMMENT ON COLUMN "ai_credit_booster_tiers"."updated_by" IS '更新人用户 ID。';
COMMENT ON COLUMN "ai_credit_booster_tiers"."deleted_at" IS '软删除时间；为空表示未删除。';
COMMENT ON COLUMN "ai_credit_booster_tiers"."version" IS '乐观锁版本。';

COMMENT ON TABLE "ai_credit_billing_configs" IS '全局计费配置单行表（固定主键 default）：最小计量单位、重置规则、折扣与订阅参数。';
COMMENT ON COLUMN "ai_credit_billing_configs"."id" IS '单行表固定主键 default。';
COMMENT ON COLUMN "ai_credit_billing_configs"."min_credit_unit" IS '最小计量单位（credit）。';
COMMENT ON COLUMN "ai_credit_billing_configs"."reset_day" IS '每月重置日（企业本地时区）。';
COMMENT ON COLUMN "ai_credit_billing_configs"."reset_timezone_mode" IS '重置时区模式：TENANT_LOCAL 企业本地时区。';
COMMENT ON COLUMN "ai_credit_billing_configs"."reject_unconfigured_rate" IS '未配置费率的调用一律拒绝。';
COMMENT ON COLUMN "ai_credit_billing_configs"."subscription_durations" IS '可配置的订阅持续时间选项。';
COMMENT ON COLUMN "ai_credit_billing_configs"."half_yearly_discount_rate" IS '半年折扣（9 折 = 0.90）。';
COMMENT ON COLUMN "ai_credit_billing_configs"."yearly_discount_rate" IS '一年折扣（8 折 = 0.80）。';
COMMENT ON COLUMN "ai_credit_billing_configs"."max_subscription_units" IS '订阅单位数量上限。';
COMMENT ON COLUMN "ai_credit_billing_configs"."updated_at" IS '更新时间。';
COMMENT ON COLUMN "ai_credit_billing_configs"."updated_by" IS '更新人用户 ID。';
COMMENT ON COLUMN "ai_credit_billing_configs"."version" IS '乐观锁版本。';
