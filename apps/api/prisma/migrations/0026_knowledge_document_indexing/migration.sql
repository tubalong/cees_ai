-- 知识库文档处理状态机与可见范围版本化：
-- 1) documents.status 从 TEXT 改为枚举 KnowledgeDocumentStatus（PENDING/PARSING/PARSED/INDEXING/READY/FAILED）；
-- 2) documents 记录当前处理版本、重试计数、失败原因与最后处理时间；
-- 3) 可见范围下沉为版本级属性（document_versions），并锁定 file_object_id 唯一；
-- 4) document_chunks 删除向量列，向量改由 ai-service 独立 pgvector database 管理。

-- 1. 文档处理状态枚举
CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('PENDING', 'PARSING', 'PARSED', 'INDEXING', 'READY', 'FAILED');

-- 2. documents 状态列改造与新增字段
ALTER TABLE "documents" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "documents" ALTER COLUMN "status" SET DATA TYPE "KnowledgeDocumentStatus"
    USING ("status"::text::"KnowledgeDocumentStatus");
ALTER TABLE "documents" ALTER COLUMN "status" SET DEFAULT 'PENDING';

ALTER TABLE "documents" ADD COLUMN "current_version_id" UUID;
ALTER TABLE "documents" ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "documents" ADD COLUMN "last_error" TEXT;
ALTER TABLE "documents" ADD COLUMN "last_processed_at" TIMESTAMP(3);

ALTER TABLE "documents" DROP COLUMN "department_id";
ALTER TABLE "documents" DROP COLUMN "project_id";

-- 3. 版本可见范围与文件对象唯一
ALTER TABLE "document_versions" ADD COLUMN "visibility_scope" "VisibilityScope" NOT NULL;
ALTER TABLE "document_versions" ADD COLUMN "department_id" UUID;
ALTER TABLE "document_versions" ADD COLUMN "project_id" UUID;

CREATE UNIQUE INDEX "document_versions_file_object_id_key" ON "document_versions"("file_object_id");

-- 4. 移除业务库向量列
ALTER TABLE "document_chunks" DROP COLUMN "embedding";

-- 注释
COMMENT ON COLUMN documents.status IS '文档处理状态：PENDING、PARSING、PARSED、INDEXING、READY 或 FAILED。';
COMMENT ON COLUMN documents.current_version_id IS '当前处理中的文档版本 ID。';
COMMENT ON COLUMN documents.retry_count IS '当前处理周期内累计失败重试次数，处理成功或手动重试时清零。';
COMMENT ON COLUMN documents.last_error IS '最近一次处理失败原因，成功后清空。';
COMMENT ON COLUMN documents.last_processed_at IS '最近一次后台处理完成时间。';
COMMENT ON COLUMN document_versions.visibility_scope IS '文档版本可见范围：PRIVATE、DEPARTMENT、PROJECT、TENANT 或 CUSTOM。';
COMMENT ON COLUMN document_versions.department_id IS '可见范围为 DEPARTMENT 时指定的部门 ID。';
COMMENT ON COLUMN document_versions.project_id IS '可见范围为 PROJECT 时指定的项目 ID。';
