-- 项目编码改由服务端按租户时区年份自动分配，需要按“租户 + 年份”记录流水号。
CREATE TABLE "project_code_sequences" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_code_sequences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_code_sequences_tenant_id_year_key" ON "project_code_sequences"("tenant_id", "year");

ALTER TABLE "project_code_sequences"
    ADD CONSTRAINT "project_code_sequences_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 回填：只识别 PRJ-YYYY-N 形式的历史编码，其余历史编码（legacy-* 等）保持原样且不占用流水号。
INSERT INTO "project_code_sequences" ("id", "tenant_id", "year", "last_number", "created_at", "updated_at")
SELECT gen_random_uuid(), grouped."tenant_id", grouped."year", MAX(grouped."number"), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
    SELECT
        "tenant_id",
        (regexp_match("code", '^PRJ-([0-9]{4})-([0-9]+)$', 'i'))[1]::INTEGER AS "year",
        (regexp_match("code", '^PRJ-([0-9]{4})-([0-9]+)$', 'i'))[2]::INTEGER AS "number"
    FROM "projects"
    WHERE "code" ~* '^PRJ-[0-9]{4}-[0-9]+$'
) AS grouped
GROUP BY grouped."tenant_id", grouped."year";

COMMENT ON TABLE "project_code_sequences" IS '项目编码流水号：按租户与租户时区年份分配 PRJ-<年>-<序号>，序号只增不减';
COMMENT ON COLUMN "project_code_sequences"."tenant_id" IS '所属租户';
COMMENT ON COLUMN "project_code_sequences"."year" IS '租户时区下的自然年';
COMMENT ON COLUMN "project_code_sequences"."last_number" IS '该租户该年份已分配到的最大项目序号';
COMMENT ON COLUMN "project_code_sequences"."created_at" IS '创建时间';
COMMENT ON COLUMN "project_code_sequences"."updated_at" IS '更新时间';

-- 项目时间字段改为系统时间戳：starts_at 语义调整为首次启动时间，ends_at（人工填写的计划结束日期）删除，
-- 新增 closed_at（取消或归档时写入）。历史 starts_at 值保留，历史 ends_at 计划结束日期随字段删除。
ALTER TABLE "projects" RENAME COLUMN "starts_at" TO "started_at";
ALTER TABLE "projects" DROP COLUMN "ends_at";
ALTER TABLE "projects" ADD COLUMN "closed_at" TIMESTAMP(3);

COMMENT ON COLUMN "projects"."started_at" IS '首次启动时间，项目从规划流转为进行中时由系统写入，此后不再变更';
COMMENT ON COLUMN "projects"."closed_at" IS '关闭时间，项目被取消或归档时由系统写入，归档恢复时清空';
