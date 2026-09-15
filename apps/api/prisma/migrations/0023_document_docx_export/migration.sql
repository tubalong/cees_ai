-- 文档导出 DOCX 支持：managed_documents 增加 document_spec 列，
-- 保存 ai-service compose 返回的结构化 DocumentSpec，作为 render-docx 导出的事实源。
-- 存量行与人工创建文档该列为空，导出时返回明确错误而不是猜测内容。
ALTER TABLE "managed_documents"
    ADD COLUMN "document_spec" JSONB;

COMMENT ON COLUMN "managed_documents"."document_spec" IS 'ai-service compose 返回的结构化 DocumentSpec，导出 DOCX 的事实源；人工创建或内容被手工修改的文档为空';
