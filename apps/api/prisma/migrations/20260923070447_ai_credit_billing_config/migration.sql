-- CreateEnum
CREATE TYPE "AICreditConfigStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AICreditMeterType" AS ENUM ('TOKEN', 'PER_REQUEST');

-- CreateEnum
CREATE TYPE "AICreditCapabilityKind" AS ENUM ('TIER_GATED', 'UNIVERSAL');

-- CreateEnum
CREATE TYPE "AICreditRateDimension" AS ENUM ('TOKEN_INPUT', 'TOKEN_OUTPUT', 'PER_REQUEST');

-- CreateEnum
CREATE TYPE "AICreditSubscriptionDuration" AS ENUM ('ONE_MONTH', 'SIX_MONTHS', 'TWELVE_MONTHS');

-- CreateTable
CREATE TABLE "ai_credit_capabilities" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "meter_type" "AICreditMeterType" NOT NULL DEFAULT 'TOKEN',
    "capability_kind" "AICreditCapabilityKind" NOT NULL DEFAULT 'TIER_GATED',
    "permission_code" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "AICreditConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ai_credit_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_credit_tiers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthly_base_credits" DECIMAL(18,2) NOT NULL,
    "status" "AICreditConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ai_credit_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_credit_tier_prices" (
    "id" UUID NOT NULL,
    "tier_id" UUID NOT NULL,
    "duration" "AICreditSubscriptionDuration" NOT NULL,
    "tier_price" DECIMAL(18,2) NOT NULL,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_credit_tier_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_credit_tier_capabilities" (
    "id" UUID NOT NULL,
    "tier_id" UUID NOT NULL,
    "capability_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_credit_tier_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_credit_rate_cards" (
    "id" UUID NOT NULL,
    "capability_id" UUID NOT NULL,
    "model_group" TEXT NOT NULL DEFAULT 'default',
    "dimension" "AICreditRateDimension" NOT NULL,
    "token_multiplier" DECIMAL(10,4),
    "credit_per_token" DECIMAL(10,4),
    "per_request_credits" DECIMAL(18,2),
    "rate_version" INTEGER NOT NULL DEFAULT 1,
    "status" "AICreditConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ai_credit_rate_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_credit_booster_tiers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "credits" DECIMAL(18,2) NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "description" TEXT,
    "status" "AICreditConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ai_credit_booster_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_credit_billing_configs" (
    "id" TEXT NOT NULL,
    "min_credit_unit" DECIMAL(4,1) NOT NULL DEFAULT 0.1,
    "reset_day" INTEGER NOT NULL DEFAULT 1,
    "reset_timezone_mode" TEXT NOT NULL DEFAULT 'TENANT_LOCAL',
    "reject_unconfigured_rate" BOOLEAN NOT NULL DEFAULT true,
    "subscription_durations" "AICreditSubscriptionDuration"[] DEFAULT ARRAY[]::"AICreditSubscriptionDuration"[],
    "half_yearly_discount_rate" DECIMAL(4,2) NOT NULL DEFAULT 0.90,
    "yearly_discount_rate" DECIMAL(4,2) NOT NULL DEFAULT 0.80,
    "max_subscription_units" INTEGER NOT NULL DEFAULT 500,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ai_credit_billing_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_credit_capabilities_code_key" ON "ai_credit_capabilities"("code");

-- CreateIndex
CREATE INDEX "ai_credit_capabilities_status_sort_order_idx" ON "ai_credit_capabilities"("status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "ai_credit_tiers_code_key" ON "ai_credit_tiers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ai_credit_tier_prices_tier_id_duration_key" ON "ai_credit_tier_prices"("tier_id", "duration");

-- CreateIndex
CREATE INDEX "ai_credit_tier_capabilities_capability_id_idx" ON "ai_credit_tier_capabilities"("capability_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_credit_tier_capabilities_tier_id_capability_id_key" ON "ai_credit_tier_capabilities"("tier_id", "capability_id");

-- CreateIndex
CREATE INDEX "ai_credit_rate_cards_capability_id_model_group_dimension_idx" ON "ai_credit_rate_cards"("capability_id", "model_group", "dimension");

-- CreateIndex
CREATE UNIQUE INDEX "ai_credit_rate_cards_capability_id_model_group_dimension_ra_key" ON "ai_credit_rate_cards"("capability_id", "model_group", "dimension", "rate_version");

-- AddForeignKey
ALTER TABLE "ai_credit_tier_prices" ADD CONSTRAINT "ai_credit_tier_prices_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "ai_credit_tiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_credit_tier_capabilities" ADD CONSTRAINT "ai_credit_tier_capabilities_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "ai_credit_tiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_credit_tier_capabilities" ADD CONSTRAINT "ai_credit_tier_capabilities_capability_id_fkey" FOREIGN KEY ("capability_id") REFERENCES "ai_credit_capabilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_credit_rate_cards" ADD CONSTRAINT "ai_credit_rate_cards_capability_id_fkey" FOREIGN KEY ("capability_id") REFERENCES "ai_credit_capabilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
