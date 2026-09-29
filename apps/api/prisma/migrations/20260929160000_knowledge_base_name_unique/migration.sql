-- 同租户内知识库名称唯一，且软删除后释放名称。
--
-- 用「归一列 + 普通唯一约束」而不是直接约束 name：
--   * 归一值取 lower(btrim(name))，因此同租户内大小写、首尾空格不同的同名视为冲突；
--   * 软删除行改写为 `<归一名称>#<id>`，值仍然唯一但不再占用名称，
--     用户删除后可以用同名重建；
--   * 完全由 Prisma schema 表达，不依赖部分唯一索引（WHERE deleted_at IS NULL），
--     避免 `prisma migrate dev` 把索引判定为漂移后尝试删除。
--
-- 迁移前已核对：不存在任何 (tenant_id, 归一名称) 重复的存活行，
-- 也不存在附加软删除后缀后仍然重复的行，因此回填不会失败。

ALTER TABLE "knowledge_bases" ADD COLUMN "normalized_name" TEXT;

UPDATE "knowledge_bases"
SET "normalized_name" = lower(btrim("name"))
    || CASE WHEN "deleted_at" IS NULL THEN '' ELSE '#' || "id"::text END;

ALTER TABLE "knowledge_bases" ALTER COLUMN "normalized_name" SET NOT NULL;

CREATE UNIQUE INDEX "knowledge_bases_tenant_id_normalized_name_key"
    ON "knowledge_bases"("tenant_id", "normalized_name");

COMMENT ON COLUMN "knowledge_bases"."normalized_name" IS '名称唯一性归一值；软删除时追加 #<id> 以释放名称';
