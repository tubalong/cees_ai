-- CreateEnum
CREATE TYPE "KnowledgeDocumentSourceType" AS ENUM ('FILE_OBJECT', 'DOCUMENT', 'MESSAGE');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "source_id" UUID,
ADD COLUMN     "source_type" "KnowledgeDocumentSourceType";

-- CreateIndex
CREATE INDEX "documents_tenant_id_source_type_source_id_idx" ON "documents"("tenant_id", "source_type", "source_id");

-- 部分唯一索引：同一租户内一个来源（转存锚定）只存一个知识库；人工上传文档（source_type 为空）不受限。
CREATE UNIQUE INDEX "documents_tenant_id_source_type_source_id_key" ON "documents"("tenant_id", "source_type", "source_id") WHERE "source_type" IS NOT NULL;
