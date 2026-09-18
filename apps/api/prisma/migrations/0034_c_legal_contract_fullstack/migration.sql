-- CreateEnum
CREATE TYPE "LegalContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PENDING_RENEWAL', 'EXPIRED', 'TERMINATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LegalContractType" AS ENUM ('PURCHASE', 'SALES', 'SERVICE', 'EMPLOYMENT', 'NDA', 'LEASE', 'OTHER');

-- CreateTable
CREATE TABLE "legal_contract_sequences" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_contract_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_contracts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_no" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "type" "LegalContractType" NOT NULL,
    "amount" DECIMAL(18,2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CNY',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "signed_at" DATE,
    "status" "LegalContractStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "owner_membership_id" UUID NOT NULL,
    "department_id" UUID,
    "project_id" UUID,
    "renewal_reminder_days" INTEGER NOT NULL DEFAULT 30,
    "activated_at" TIMESTAMP(3),
    "terminated_at" TIMESTAMP(3),
    "termination_reason" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "legal_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_contract_attachments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "file_object_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_contract_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_contract_status_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "from_status" "LegalContractStatus",
    "to_status" "LegalContractStatus" NOT NULL,
    "actor_membership_id" UUID,
    "comment" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_contract_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "legal_contract_sequences_tenant_id_year_key" ON "legal_contract_sequences"("tenant_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "legal_contracts_tenant_id_contract_no_key" ON "legal_contracts"("tenant_id", "contract_no");

-- CreateIndex
CREATE INDEX "legal_contracts_tenant_id_status_end_date_idx" ON "legal_contracts"("tenant_id", "status", "end_date");

-- CreateIndex
CREATE INDEX "legal_contracts_tenant_id_owner_membership_id_updated_at_idx" ON "legal_contracts"("tenant_id", "owner_membership_id", "updated_at");

-- CreateIndex
CREATE INDEX "legal_contracts_tenant_id_department_id_status_idx" ON "legal_contracts"("tenant_id", "department_id", "status");

-- CreateIndex
CREATE INDEX "legal_contracts_tenant_id_project_id_status_idx" ON "legal_contracts"("tenant_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "legal_contract_attachments_contract_id_file_object_id_key" ON "legal_contract_attachments"("contract_id", "file_object_id");

-- CreateIndex
CREATE INDEX "legal_contract_attachments_tenant_id_contract_id_idx" ON "legal_contract_attachments"("tenant_id", "contract_id");

-- CreateIndex
CREATE INDEX "legal_contract_attachments_file_object_id_idx" ON "legal_contract_attachments"("file_object_id");

-- CreateIndex
CREATE INDEX "legal_contract_status_history_tenant_id_contract_id_created_at_idx" ON "legal_contract_status_history"("tenant_id", "contract_id", "created_at");

-- AddForeignKey
ALTER TABLE "legal_contract_sequences" ADD CONSTRAINT "legal_contract_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_contracts" ADD CONSTRAINT "legal_contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_contracts" ADD CONSTRAINT "legal_contracts_owner_membership_id_fkey" FOREIGN KEY ("owner_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_contracts" ADD CONSTRAINT "legal_contracts_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_contracts" ADD CONSTRAINT "legal_contracts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_contract_attachments" ADD CONSTRAINT "legal_contract_attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_contract_attachments" ADD CONSTRAINT "legal_contract_attachments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "legal_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_contract_attachments" ADD CONSTRAINT "legal_contract_attachments_file_object_id_fkey" FOREIGN KEY ("file_object_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_contract_status_history" ADD CONSTRAINT "legal_contract_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_contract_status_history" ADD CONSTRAINT "legal_contract_status_history_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "legal_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_contract_status_history" ADD CONSTRAINT "legal_contract_status_history_actor_membership_id_fkey" FOREIGN KEY ("actor_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMENT ON TABLE "legal_contract_sequences" IS '租户按年度生成合同编号的计数器';
COMMENT ON TABLE "legal_contracts" IS '租户级合同台账主体及生命周期状态';
COMMENT ON TABLE "legal_contract_attachments" IS '合同与正式文件对象的关联';
COMMENT ON TABLE "legal_contract_status_history" IS '合同状态流转历史';
COMMENT ON COLUMN "legal_contracts"."contract_no" IS '租户内唯一的人类可读合同编号';
COMMENT ON COLUMN "legal_contracts"."department_id" IS '合同业务归属部门快照，不随负责人调岗自动变化';
COMMENT ON COLUMN "legal_contracts"."renewal_reminder_days" IS '到期前进入待续签状态的提前天数';
