-- CreateEnum
CREATE TYPE "FinanceExpenseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED', 'PAID');

-- CreateEnum
CREATE TYPE "FinancePaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'CORPORATE_CARD', 'OTHER');

-- CreateTable
CREATE TABLE "finance_expense_categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "finance_expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_expense_report_sequences" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_expense_report_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_expense_reports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "report_no" TEXT NOT NULL,
    "requester_membership_id" UUID NOT NULL,
    "requester_department_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CNY',
    "total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "FinanceExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_comment" TEXT,
    "paid_by" UUID,
    "paid_at" TIMESTAMP(3),
    "payment_method" "FinancePaymentMethod",
    "payment_reference" TEXT,
    "payment_comment" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "finance_expense_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_expense_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "occurred_at" DATE NOT NULL,
    "merchant_name" TEXT,
    "invoice_number" TEXT,
    "invoice_type" TEXT,
    "project_id" UUID,
    "department_id" UUID,
    "remark" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "finance_expense_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_expense_attachments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "item_id" UUID,
    "file_object_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_expense_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_expense_status_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "from_status" "FinanceExpenseStatus",
    "to_status" "FinanceExpenseStatus" NOT NULL,
    "actor_membership_id" UUID NOT NULL,
    "comment" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_expense_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finance_expense_categories_tenant_id_enabled_idx" ON "finance_expense_categories"("tenant_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "finance_expense_report_sequences_tenant_id_year_key" ON "finance_expense_report_sequences"("tenant_id", "year");

-- CreateIndex
CREATE INDEX "finance_expense_reports_tenant_id_status_created_at_idx" ON "finance_expense_reports"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "finance_expense_reports_tenant_id_requester_membership_id_c_idx" ON "finance_expense_reports"("tenant_id", "requester_membership_id", "created_at");

-- CreateIndex
CREATE INDEX "finance_expense_reports_tenant_id_requester_department_id_s_idx" ON "finance_expense_reports"("tenant_id", "requester_department_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "finance_expense_reports_tenant_id_report_no_key" ON "finance_expense_reports"("tenant_id", "report_no");

-- CreateIndex
CREATE INDEX "finance_expense_items_tenant_id_report_id_sort_order_idx" ON "finance_expense_items"("tenant_id", "report_id", "sort_order");

-- CreateIndex
CREATE INDEX "finance_expense_items_tenant_id_category_id_occurred_at_idx" ON "finance_expense_items"("tenant_id", "category_id", "occurred_at");

-- CreateIndex
CREATE INDEX "finance_expense_items_tenant_id_project_id_occurred_at_idx" ON "finance_expense_items"("tenant_id", "project_id", "occurred_at");

-- CreateIndex
CREATE INDEX "finance_expense_items_tenant_id_department_id_occurred_at_idx" ON "finance_expense_items"("tenant_id", "department_id", "occurred_at");

-- CreateIndex
CREATE INDEX "finance_expense_attachments_tenant_id_report_id_idx" ON "finance_expense_attachments"("tenant_id", "report_id");

-- CreateIndex
CREATE INDEX "finance_expense_attachments_file_object_id_idx" ON "finance_expense_attachments"("file_object_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_expense_attachments_report_id_file_object_id_key" ON "finance_expense_attachments"("report_id", "file_object_id");

-- CreateIndex
CREATE INDEX "finance_expense_status_history_tenant_id_report_id_created__idx" ON "finance_expense_status_history"("tenant_id", "report_id", "created_at");

-- AddForeignKey
ALTER TABLE "finance_expense_categories" ADD CONSTRAINT "finance_expense_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_report_sequences" ADD CONSTRAINT "finance_expense_report_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_reports" ADD CONSTRAINT "finance_expense_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_reports" ADD CONSTRAINT "finance_expense_reports_requester_membership_id_fkey" FOREIGN KEY ("requester_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_reports" ADD CONSTRAINT "finance_expense_reports_requester_department_id_fkey" FOREIGN KEY ("requester_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_reports" ADD CONSTRAINT "finance_expense_reports_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_reports" ADD CONSTRAINT "finance_expense_reports_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_items" ADD CONSTRAINT "finance_expense_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_items" ADD CONSTRAINT "finance_expense_items_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "finance_expense_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_items" ADD CONSTRAINT "finance_expense_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "finance_expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_items" ADD CONSTRAINT "finance_expense_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_items" ADD CONSTRAINT "finance_expense_items_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_attachments" ADD CONSTRAINT "finance_expense_attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_attachments" ADD CONSTRAINT "finance_expense_attachments_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "finance_expense_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_attachments" ADD CONSTRAINT "finance_expense_attachments_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "finance_expense_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_attachments" ADD CONSTRAINT "finance_expense_attachments_file_object_id_fkey" FOREIGN KEY ("file_object_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_status_history" ADD CONSTRAINT "finance_expense_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_status_history" ADD CONSTRAINT "finance_expense_status_history_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "finance_expense_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_status_history" ADD CONSTRAINT "finance_expense_status_history_actor_membership_id_fkey" FOREIGN KEY ("actor_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Keep category codes unique among active tenant records while allowing recreation after soft deletion.
CREATE UNIQUE INDEX "finance_expense_categories_tenant_id_code_active_key"
ON "finance_expense_categories"("tenant_id", "code")
WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "finance_expense_reports_tenant_id_payment_reference_key"
ON "finance_expense_reports"("tenant_id", "payment_reference")
WHERE "payment_reference" IS NOT NULL AND "deleted_at" IS NULL;

COMMENT ON TABLE "finance_expense_categories" IS '租户级报销费用类别字典';
COMMENT ON TABLE "finance_expense_report_sequences" IS '租户按年度生成报销单号的计数器';
COMMENT ON TABLE "finance_expense_reports" IS '报销单主体及审批付款状态';
COMMENT ON TABLE "finance_expense_items" IS '报销费用明细和项目部门归属';
COMMENT ON TABLE "finance_expense_attachments" IS '报销单与正式文件对象的关联';
COMMENT ON TABLE "finance_expense_status_history" IS '报销单状态流转历史';
COMMENT ON COLUMN "finance_expense_categories"."code" IS '租户内活跃类别唯一编码';
COMMENT ON COLUMN "finance_expense_reports"."report_no" IS '租户内唯一的人类可读报销单号';
COMMENT ON COLUMN "finance_expense_reports"."total_amount" IS '由服务端对有效明细金额求和生成';
COMMENT ON COLUMN "finance_expense_reports"."status" IS '草稿、提交、批准、拒绝、撤回、取消或已付款';
COMMENT ON COLUMN "finance_expense_items"."amount" IS '费用明细含税金额，精度 18,2';
COMMENT ON COLUMN "finance_expense_items"."tax_amount" IS '费用明细税额，精度 18,2';
COMMENT ON COLUMN "finance_expense_items"."project_id" IS '供项目预算读取的项目支出归属';
COMMENT ON COLUMN "finance_expense_attachments"."file_object_id" IS '当前租户已完成上传的正式文件对象';
