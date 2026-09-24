ALTER TABLE "managed_documents"
ADD COLUMN "spreadsheet_spec" JSONB;

COMMENT ON COLUMN "managed_documents"."spreadsheet_spec" IS
'AI 生成 XLSX 的结构化 SpreadsheetSpec；与 document_spec 互斥。';