-- 财务收支台账「原文件可选留档」：导入批次记录原始上传文件（xlsx/csv）的文件对象。
-- 可空：留档是可选能力，只保存解析后的结构化数据即可完成入账；原文件用于事后核对与回滚凭据。

ALTER TABLE "finance_ledger_imports" ADD COLUMN "source_file_object_id" UUID;

COMMENT ON COLUMN "finance_ledger_imports"."source_file_object_id" IS '原始上传文件对应的文件对象 ID；未选择留档时为 NULL';
