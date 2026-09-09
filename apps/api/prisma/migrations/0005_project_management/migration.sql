CREATE TYPE "ProjectStatus" AS ENUM ('PLANNING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'ARCHIVED');
CREATE TYPE "ProjectMemberRole" AS ENUM ('OWNER', 'MANAGER', 'MEMBER');

ALTER TABLE "projects"
    ADD COLUMN "code" TEXT,
    ADD COLUMN "normalized_code" TEXT,
    ADD COLUMN "owner_membership_id" UUID,
    ADD COLUMN "starts_at" TIMESTAMP(3),
    ADD COLUMN "ends_at" TIMESTAMP(3),
    ADD COLUMN "completed_at" TIMESTAMP(3),
    ADD COLUMN "completed_by_membership_id" UUID,
    ADD COLUMN "completion_summary" TEXT;

UPDATE "projects"
SET
    "code" = 'legacy-' || left(replace("id"::text, '-', ''), 12),
    "normalized_code" = 'legacy-' || left(replace("id"::text, '-', ''), 12)
WHERE "code" IS NULL OR "normalized_code" IS NULL;

ALTER TABLE "projects"
    ALTER COLUMN "code" SET NOT NULL,
    ALTER COLUMN "normalized_code" SET NOT NULL,
    ALTER COLUMN "status" DROP DEFAULT,
    ALTER COLUMN "status" TYPE "ProjectStatus"
        USING CASE
            WHEN "status" = 'PLANNING' THEN 'PLANNING'::"ProjectStatus"
            WHEN "status" = 'PAUSED' THEN 'PAUSED'::"ProjectStatus"
            WHEN "status" = 'COMPLETED' THEN 'COMPLETED'::"ProjectStatus"
            WHEN "status" = 'CANCELLED' THEN 'CANCELLED'::"ProjectStatus"
            WHEN "status" = 'ARCHIVED' THEN 'ARCHIVED'::"ProjectStatus"
            ELSE 'ACTIVE'::"ProjectStatus"
        END,
    ALTER COLUMN "status" SET DEFAULT 'PLANNING';

ALTER TABLE "project_members"
    ADD COLUMN "membership_id" UUID,
    ADD COLUMN "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "created_by" UUID,
    ADD COLUMN "updated_by" UUID,
    ADD COLUMN "deleted_at" TIMESTAMP(3),
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "project_members" AS project_member
SET "membership_id" = membership."id"
FROM "tenant_memberships" AS membership
WHERE membership."tenant_id" = project_member."tenant_id"
  AND membership."user_id" = project_member."user_id";

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "project_members" WHERE "membership_id" IS NULL) THEN
        RAISE EXCEPTION 'project_members contains user_id values without a matching tenant_membership';
    END IF;
END $$;

ALTER TABLE "project_members"
    ALTER COLUMN "membership_id" SET NOT NULL,
    ALTER COLUMN "role" DROP DEFAULT,
    ALTER COLUMN "role" TYPE "ProjectMemberRole"
        USING CASE
            WHEN "role" = 'OWNER' THEN 'OWNER'::"ProjectMemberRole"
            WHEN "role" = 'MANAGER' THEN 'MANAGER'::"ProjectMemberRole"
            ELSE 'MEMBER'::"ProjectMemberRole"
        END,
    ALTER COLUMN "role" SET DEFAULT 'MEMBER',
    DROP COLUMN "user_id";

UPDATE "projects" AS project
SET "owner_membership_id" = (
    SELECT project_member."membership_id"
    FROM "project_members" AS project_member
    WHERE project_member."tenant_id" = project."tenant_id"
      AND project_member."project_id" = project."id"
      AND project_member."role" = 'OWNER'
      AND project_member."deleted_at" IS NULL
    ORDER BY project_member."created_at", project_member."id"
    LIMIT 1
)
WHERE project."owner_membership_id" IS NULL
  AND EXISTS (
      SELECT 1
      FROM "project_members" AS project_member
      WHERE project_member."tenant_id" = project."tenant_id"
        AND project_member."project_id" = project."id"
        AND project_member."role" = 'OWNER'
        AND project_member."deleted_at" IS NULL
  );

UPDATE "projects" AS project
SET "owner_membership_id" = membership."id"
FROM "tenant_memberships" AS membership
WHERE project."owner_membership_id" IS NULL
  AND project."created_by" = membership."user_id"
  AND project."tenant_id" = membership."tenant_id"
  AND membership."deleted_at" IS NULL;

INSERT INTO "project_members" (
    "id", "tenant_id", "project_id", "membership_id", "role", "joined_at", "created_at", "updated_at", "created_by", "version"
)
SELECT
    gen_random_uuid(), project."tenant_id", project."id", project."owner_membership_id", 'OWNER',
    project."created_at", project."created_at", CURRENT_TIMESTAMP, project."created_by", 1
FROM "projects" AS project
WHERE project."owner_membership_id" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM "project_members" AS project_member
      WHERE project_member."tenant_id" = project."tenant_id"
        AND project_member."project_id" = project."id"
        AND project_member."membership_id" = project."owner_membership_id"
  );

UPDATE "project_members" AS project_member
SET "role" = CASE
    WHEN project_member."membership_id" = project."owner_membership_id" THEN 'OWNER'::"ProjectMemberRole"
    WHEN project_member."role" = 'OWNER' THEN 'MANAGER'::"ProjectMemberRole"
    ELSE project_member."role"
END
FROM "projects" AS project
WHERE project."id" = project_member."project_id"
  AND project."tenant_id" = project_member."tenant_id";

ALTER TABLE "project_members"
    ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "project_members" DROP CONSTRAINT IF EXISTS "project_members_tenant_id_project_id_user_id_key";
DROP INDEX IF EXISTS "project_members_tenant_id_user_id_idx";

CREATE UNIQUE INDEX "projects_tenant_id_normalized_code_key" ON "projects"("tenant_id", "normalized_code");
CREATE INDEX "projects_tenant_id_owner_membership_id_idx" ON "projects"("tenant_id", "owner_membership_id");
CREATE INDEX "projects_tenant_id_status_updated_at_idx" ON "projects"("tenant_id", "status", "updated_at");
CREATE UNIQUE INDEX "project_members_tenant_id_project_id_membership_id_key" ON "project_members"("tenant_id", "project_id", "membership_id");
CREATE INDEX "project_members_tenant_id_membership_id_idx" ON "project_members"("tenant_id", "membership_id");
CREATE INDEX "project_members_tenant_id_project_id_role_idx" ON "project_members"("tenant_id", "project_id", "role");

CREATE TABLE "project_status_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "from_status" "ProjectStatus" NOT NULL,
    "to_status" "ProjectStatus" NOT NULL,
    "reason" TEXT,
    "changed_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_status_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_status_history_tenant_id_project_id_created_at_idx"
    ON "project_status_history"("tenant_id", "project_id", "created_at");
CREATE INDEX "project_status_history_tenant_id_changed_by_membership_id_c_idx"
    ON "project_status_history"("tenant_id", "changed_by_membership_id", "created_at");

ALTER TABLE "projects"
    ADD CONSTRAINT "projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "projects_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "projects_owner_membership_id_fkey" FOREIGN KEY ("owner_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "projects_completed_by_membership_id_fkey" FOREIGN KEY ("completed_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_members"
    ADD CONSTRAINT "project_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "project_members_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_status_history"
    ADD CONSTRAINT "project_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "project_status_history_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "project_status_history_changed_by_membership_id_fkey" FOREIGN KEY ("changed_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMENT ON TYPE "ProjectStatus" IS '项目生命周期状态';
COMMENT ON TYPE "ProjectMemberRole" IS '项目成员角色';
COMMENT ON TABLE "projects" IS '租户项目主表';
COMMENT ON COLUMN "projects"."id" IS '项目 UUID';
COMMENT ON COLUMN "projects"."tenant_id" IS '所属租户 UUID';
COMMENT ON COLUMN "projects"."code" IS '租户内项目业务编码';
COMMENT ON COLUMN "projects"."normalized_code" IS '规范化后的项目编码，用于租户内唯一比较';
COMMENT ON COLUMN "projects"."department_id" IS '项目业务归属部门 UUID，不自动授予部门成员访问权限';
COMMENT ON COLUMN "projects"."owner_membership_id" IS '当前项目负责人对应的租户成员 UUID';
COMMENT ON COLUMN "projects"."name" IS '项目名称';
COMMENT ON COLUMN "projects"."description" IS '项目说明';
COMMENT ON COLUMN "projects"."status" IS '项目生命周期状态';
COMMENT ON COLUMN "projects"."starts_at" IS '计划或实际开始时间';
COMMENT ON COLUMN "projects"."ends_at" IS '计划结束时间';
COMMENT ON COLUMN "projects"."completed_at" IS '最近一次完成时间';
COMMENT ON COLUMN "projects"."completed_by_membership_id" IS '最近一次完成项目的租户成员 UUID';
COMMENT ON COLUMN "projects"."completion_summary" IS '最近一次项目完成总结';
COMMENT ON COLUMN "projects"."created_at" IS '创建时间';
COMMENT ON COLUMN "projects"."updated_at" IS '更新时间';
COMMENT ON COLUMN "projects"."created_by" IS '创建人全局 User UUID';
COMMENT ON COLUMN "projects"."updated_by" IS '最后更新人全局 User UUID';
COMMENT ON COLUMN "projects"."deleted_at" IS '软删除时间';
COMMENT ON COLUMN "projects"."version" IS '乐观锁版本号';

COMMENT ON TABLE "project_members" IS '项目与租户成员关系及项目角色';
COMMENT ON COLUMN "project_members"."id" IS '项目成员关系 UUID';
COMMENT ON COLUMN "project_members"."tenant_id" IS '所属租户 UUID';
COMMENT ON COLUMN "project_members"."project_id" IS '项目 UUID';
COMMENT ON COLUMN "project_members"."membership_id" IS '租户成员 UUID，不使用全局 User UUID';
COMMENT ON COLUMN "project_members"."role" IS '项目角色：负责人、经理或成员';
COMMENT ON COLUMN "project_members"."joined_at" IS '加入项目时间';
COMMENT ON COLUMN "project_members"."created_at" IS '关系创建时间';
COMMENT ON COLUMN "project_members"."updated_at" IS '关系更新时间';
COMMENT ON COLUMN "project_members"."created_by" IS '创建人全局 User UUID';
COMMENT ON COLUMN "project_members"."updated_by" IS '最后更新人全局 User UUID';
COMMENT ON COLUMN "project_members"."deleted_at" IS '移出项目时间；重新加入时恢复该记录';
COMMENT ON COLUMN "project_members"."version" IS '乐观锁版本号';

COMMENT ON TABLE "project_status_history" IS '项目状态变更历史';
COMMENT ON COLUMN "project_status_history"."id" IS '状态历史 UUID';
COMMENT ON COLUMN "project_status_history"."tenant_id" IS '所属租户 UUID';
COMMENT ON COLUMN "project_status_history"."project_id" IS '项目 UUID';
COMMENT ON COLUMN "project_status_history"."from_status" IS '变更前项目状态';
COMMENT ON COLUMN "project_status_history"."to_status" IS '变更后项目状态';
COMMENT ON COLUMN "project_status_history"."reason" IS '状态变更原因或完成总结';
COMMENT ON COLUMN "project_status_history"."changed_by_membership_id" IS '执行状态变更的租户成员 UUID';
COMMENT ON COLUMN "project_status_history"."created_at" IS '状态变更时间';
