CREATE TYPE "FinanceLedgerDirection" AS ENUM ('INCOME', 'EXPENSE');
CREATE TYPE "FinanceLedgerSource" AS ENUM ('IMPORT', 'MANUAL');
CREATE TYPE "FinanceLedgerImportStatus" AS ENUM ('PENDING', 'PARSING', 'SUCCEEDED', 'PARTIAL', 'FAILED');
CREATE TYPE "DashboardSnapshotPeriod" AS ENUM ('DAY', 'MONTH');

CREATE TABLE "finance_ledger_imports" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "file_name" TEXT NOT NULL,
  "format" VARCHAR(8) NOT NULL DEFAULT 'XLSX',
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "status" "FinanceLedgerImportStatus" NOT NULL DEFAULT 'PENDING',
  "row_count" INTEGER NOT NULL DEFAULT 0,
  "imported_count" INTEGER NOT NULL DEFAULT 0,
  "skipped_count" INTEGER NOT NULL DEFAULT 0,
  "error_count" INTEGER NOT NULL DEFAULT 0,
  "errors" JSONB,
  "uploaded_by_membership_id" UUID NOT NULL,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by" UUID,
  "deleted_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "finance_ledger_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "finance_ledger_entries" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "import_id" UUID,
  "occurred_on" DATE NOT NULL,
  "direction" "FinanceLedgerDirection" NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'CNY',
  "category_code" TEXT,
  "category_name" TEXT,
  "department_id" UUID,
  "project_id" UUID,
  "counterparty" TEXT,
  "summary" TEXT,
  "voucher_no" TEXT,
  "source" "FinanceLedgerSource" NOT NULL DEFAULT 'IMPORT',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by" UUID,
  "updated_by" UUID,
  "deleted_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "finance_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dashboard_metric_snapshots" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "metric_key" VARCHAR(64) NOT NULL,
  "period" "DashboardSnapshotPeriod" NOT NULL,
  "period_start" DATE NOT NULL,
  "scope_key" VARCHAR(64) NOT NULL DEFAULT 'TENANT',
  "value" DECIMAL(20,4) NOT NULL,
  "meta" JSONB,
  "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "dashboard_metric_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "finance_ledger_imports_tenant_id_status_created_at_idx" ON "finance_ledger_imports"("tenant_id", "status", "created_at");
CREATE INDEX "finance_ledger_imports_tenant_id_period_start_idx" ON "finance_ledger_imports"("tenant_id", "period_start");
CREATE UNIQUE INDEX "finance_ledger_entries_tenant_id_direction_occurred_on_voucher_no_key" ON "finance_ledger_entries"("tenant_id", "direction", "occurred_on", "voucher_no");
CREATE INDEX "finance_ledger_entries_tenant_id_occurred_on_direction_idx" ON "finance_ledger_entries"("tenant_id", "occurred_on", "direction");
CREATE INDEX "finance_ledger_entries_tenant_id_department_id_occurred_on_idx" ON "finance_ledger_entries"("tenant_id", "department_id", "occurred_on");
CREATE INDEX "finance_ledger_entries_tenant_id_project_id_occurred_on_idx" ON "finance_ledger_entries"("tenant_id", "project_id", "occurred_on");
CREATE INDEX "finance_ledger_entries_tenant_id_import_id_idx" ON "finance_ledger_entries"("tenant_id", "import_id");
CREATE UNIQUE INDEX "dashboard_metric_snapshots_tenant_id_metric_key_period_period_start_scope_key_key" ON "dashboard_metric_snapshots"("tenant_id", "metric_key", "period", "period_start", "scope_key");
CREATE INDEX "dashboard_metric_snapshots_tenant_id_period_period_start_metric_key_idx" ON "dashboard_metric_snapshots"("tenant_id", "period", "period_start", "metric_key");
CREATE INDEX "dashboard_metric_snapshots_tenant_id_metric_key_period_start_idx" ON "dashboard_metric_snapshots"("tenant_id", "metric_key", "period_start");

ALTER TABLE "finance_ledger_imports" ADD CONSTRAINT "finance_ledger_imports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_ledger_entries" ADD CONSTRAINT "finance_ledger_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_ledger_entries" ADD CONSTRAINT "finance_ledger_entries_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "finance_ledger_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dashboard_metric_snapshots" ADD CONSTRAINT "dashboard_metric_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;