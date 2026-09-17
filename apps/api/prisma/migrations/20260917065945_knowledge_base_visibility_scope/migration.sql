-- AlterTable
ALTER TABLE "knowledge_bases" ADD COLUMN     "visibility_scope" "VisibilityScope" NOT NULL DEFAULT 'PRIVATE';

-- CreateIndex
CREATE INDEX "knowledge_bases_tenant_id_visibility_scope_idx" ON "knowledge_bases"("tenant_id", "visibility_scope");
