-- 将 20260921093000 手写迁移中与 schema.prisma @@index map 名不一致的索引名统一为 Prisma 截断名，
-- 消除 migrate dev 每次对比迁移历史与 schema.prisma 时产生的索引 rename drift。
-- 仅重命名索引，不重建索引、不修改数据。
ALTER INDEX "dashboard_metric_snapshots_tenant_id_metric_key_period_period_s"
    RENAME TO "dashboard_metric_snapshots_tenant_id_metric_key_period_peri_key";
ALTER INDEX "dashboard_metric_snapshots_tenant_id_metric_key_period_start_id"
    RENAME TO "dashboard_metric_snapshots_tenant_id_metric_key_period_star_idx";
ALTER INDEX "dashboard_metric_snapshots_tenant_id_period_period_start_metric"
    RENAME TO "dashboard_metric_snapshots_tenant_id_period_period_start_me_idx";
ALTER INDEX "finance_ledger_entries_tenant_id_direction_occurred_on_voucher_"
    RENAME TO "finance_ledger_entries_tenant_id_direction_occurred_on_vouc_key";
