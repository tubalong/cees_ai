-- AssignmentPolicy: tenant default + project override assignment rules for C-owned modules.
CREATE TYPE "AssignmentPolicyDomain" AS ENUM ('TASK', 'MEETING', 'WORK_REPORT', 'PROJECT', 'DOCUMENT');
CREATE TYPE "AssignmentPolicyLevel" AS ENUM ('TENANT', 'PROJECT');
CREATE TYPE "AssignmentPolicyFallbackMode" AS ENUM ('NONE', 'PROJECT_MEMBERS', 'TENANT_MEMBERS');

CREATE TABLE "assignment_policies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID,
    "domain" "AssignmentPolicyDomain" NOT NULL,
    "level" "AssignmentPolicyLevel" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "candidate_pool" JSONB NOT NULL,
    "skip_on_leave" BOOLEAN NOT NULL DEFAULT false,
    "fallback_mode" "AssignmentPolicyFallbackMode" NOT NULL DEFAULT 'NONE',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "assignment_policies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assignment_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "assignment_policies_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "assignment_policies_tenant_id_domain_level_project_id_key"
    ON "assignment_policies"("tenant_id", "domain", "level", "project_id")
    WHERE "deleted_at" IS NULL;

CREATE INDEX "assignment_policies_tenant_id_level_project_id_enabled_idx"
    ON "assignment_policies"("tenant_id", "level", "project_id", "enabled");

CREATE INDEX "assignment_policies_tenant_id_domain_enabled_idx"
    ON "assignment_policies"("tenant_id", "domain", "enabled");

COMMENT ON TYPE "AssignmentPolicyDomain" IS '分配策略适用业务领域';
COMMENT ON TYPE "AssignmentPolicyLevel" IS '策略层级：TENANT 租户默认，PROJECT 项目覆盖';
COMMENT ON TYPE "AssignmentPolicyFallbackMode" IS '候选池为空时的兜底范围';
COMMENT ON COLUMN "assignment_policies"."candidate_pool" IS '候选池 JSON：membershipIds/departmentIds/projectIds';
COMMENT ON COLUMN "assignment_policies"."skip_on_leave" IS '解析时是否过滤请假人员；P2 接入真实请假数据';
COMMENT ON COLUMN "assignment_policies"."fallback_mode" IS '候选池为空时是否回退到项目成员或租户成员';
