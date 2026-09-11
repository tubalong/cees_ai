CREATE TYPE "WorkReportType" AS ENUM ('DAILY', 'WEEKLY');
CREATE TYPE "WorkReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

CREATE TABLE "work_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "author_membership_id" UUID NOT NULL,
    "reviewer_membership_id" UUID,
    "type" "WorkReportType" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "content" JSONB NOT NULL,
    "status" "WorkReportStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "reviewed_at" TIMESTAMP(3),
    "review_comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "work_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "work_report_projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "work_report_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    CONSTRAINT "work_report_projects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "work_report_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "work_report_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    CONSTRAINT "work_report_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "work_reports_active_author_period_key"
    ON "work_reports"("tenant_id", "author_membership_id", "type", "period_start")
    WHERE "deleted_at" IS NULL;
CREATE INDEX "work_reports_tenant_id_author_membership_id_period_start_idx"
    ON "work_reports"("tenant_id", "author_membership_id", "period_start");
CREATE INDEX "work_reports_tenant_id_reviewer_membership_id_status_submitted_idx"
    ON "work_reports"("tenant_id", "reviewer_membership_id", "status", "submitted_at");
CREATE INDEX "work_reports_tenant_id_type_period_start_idx"
    ON "work_reports"("tenant_id", "type", "period_start");

CREATE UNIQUE INDEX "work_report_projects_tenant_id_work_report_id_project_id_key"
    ON "work_report_projects"("tenant_id", "work_report_id", "project_id");
CREATE INDEX "work_report_projects_tenant_id_project_id_created_at_idx"
    ON "work_report_projects"("tenant_id", "project_id", "created_at");

CREATE UNIQUE INDEX "work_report_tasks_tenant_id_work_report_id_task_id_key"
    ON "work_report_tasks"("tenant_id", "work_report_id", "task_id");
CREATE INDEX "work_report_tasks_tenant_id_task_id_created_at_idx"
    ON "work_report_tasks"("tenant_id", "task_id", "created_at");

ALTER TABLE "work_reports"
    ADD CONSTRAINT "work_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "work_reports_author_membership_id_fkey" FOREIGN KEY ("author_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "work_reports_reviewer_membership_id_fkey" FOREIGN KEY ("reviewer_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "work_report_projects"
    ADD CONSTRAINT "work_report_projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "work_report_projects_work_report_id_fkey" FOREIGN KEY ("work_report_id") REFERENCES "work_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "work_report_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "work_report_tasks"
    ADD CONSTRAINT "work_report_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "work_report_tasks_work_report_id_fkey" FOREIGN KEY ("work_report_id") REFERENCES "work_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "work_report_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "code", "name", "created_at", "updated_at") VALUES
    (gen_random_uuid(), 'work_report.create', '创建日报周报', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'work_report.read', '查看日报周报', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'work_report.update', '修改日报周报', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'work_report.delete', '删除日报周报草稿', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'work_report.submit', '提交和撤回日报周报', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'work_report.review', '审核日报周报', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'work_report.manage_all', '管理当前租户全部日报周报', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "tenant_id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."tenant_id", role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."code" = 'tenant_admin'
  AND role."deleted_at" IS NULL
  AND permission."code" IN (
      'work_report.create', 'work_report.read', 'work_report.update', 'work_report.delete',
      'work_report.submit', 'work_report.review', 'work_report.manage_all'
  )
ON CONFLICT ("tenant_id", "role_id", "permission_id") DO NOTHING;

COMMENT ON TYPE "WorkReportType" IS '工作报告类型：日报或周报';
COMMENT ON TYPE "WorkReportStatus" IS '工作报告状态：草稿、已提交、已通过或已驳回';

COMMENT ON TABLE "work_reports" IS '租户成员日报和周报主表';
COMMENT ON COLUMN "work_reports"."id" IS '工作报告 UUID';
COMMENT ON COLUMN "work_reports"."tenant_id" IS '所属租户 UUID';
COMMENT ON COLUMN "work_reports"."author_membership_id" IS '报告作者的租户成员 UUID';
COMMENT ON COLUMN "work_reports"."reviewer_membership_id" IS '指定审核人的租户成员 UUID，可空';
COMMENT ON COLUMN "work_reports"."type" IS '报告类型 WorkReportType';
COMMENT ON COLUMN "work_reports"."period_start" IS '报告周期开始日期；日报等于报告日期，周报为周一';
COMMENT ON COLUMN "work_reports"."period_end" IS '报告周期结束日期；日报等于报告日期，周报为周日';
COMMENT ON COLUMN "work_reports"."content" IS '完成事项、计划、问题和备注组成的结构化 JSON';
COMMENT ON COLUMN "work_reports"."status" IS '报告状态 WorkReportStatus';
COMMENT ON COLUMN "work_reports"."submitted_at" IS '最近一次提交时间';
COMMENT ON COLUMN "work_reports"."reviewed_at" IS '最近一次审核时间';
COMMENT ON COLUMN "work_reports"."review_comment" IS '最近一次审核意见';
COMMENT ON COLUMN "work_reports"."created_at" IS '创建时间';
COMMENT ON COLUMN "work_reports"."updated_at" IS '最后更新时间';
COMMENT ON COLUMN "work_reports"."created_by" IS '创建人全局 User UUID';
COMMENT ON COLUMN "work_reports"."updated_by" IS '最后更新人全局 User UUID';
COMMENT ON COLUMN "work_reports"."deleted_at" IS '软删除时间';
COMMENT ON COLUMN "work_reports"."version" IS '报告乐观锁版本号';

COMMENT ON TABLE "work_report_projects" IS '工作报告与项目的关联表';
COMMENT ON COLUMN "work_report_projects"."id" IS '报告项目关系 UUID';
COMMENT ON COLUMN "work_report_projects"."tenant_id" IS '所属租户 UUID';
COMMENT ON COLUMN "work_report_projects"."work_report_id" IS '工作报告 UUID';
COMMENT ON COLUMN "work_report_projects"."project_id" IS '关联项目 UUID';
COMMENT ON COLUMN "work_report_projects"."created_at" IS '关系创建时间';
COMMENT ON COLUMN "work_report_projects"."created_by" IS '创建人全局 User UUID';

COMMENT ON TABLE "work_report_tasks" IS '工作报告与任务的关联表';
COMMENT ON COLUMN "work_report_tasks"."id" IS '报告任务关系 UUID';
COMMENT ON COLUMN "work_report_tasks"."tenant_id" IS '所属租户 UUID';
COMMENT ON COLUMN "work_report_tasks"."work_report_id" IS '工作报告 UUID';
COMMENT ON COLUMN "work_report_tasks"."task_id" IS '关联任务 UUID';
COMMENT ON COLUMN "work_report_tasks"."created_at" IS '关系创建时间';
COMMENT ON COLUMN "work_report_tasks"."created_by" IS '创建人全局 User UUID';
