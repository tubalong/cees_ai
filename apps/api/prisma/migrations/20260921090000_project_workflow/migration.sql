-- CreateEnum
CREATE TYPE "ConversationContextType" AS ENUM ('GENERAL', 'PROJECT');

-- CreateEnum
CREATE TYPE "ProjectDecisionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ProjectMilestoneStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'ACCEPTANCE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectRepositoryProvider" AS ENUM ('GITHUB', 'GITLAB', 'GITEE', 'OTHER');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "context_type" "ConversationContextType" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "project_id" UUID;

-- CreateTable
CREATE TABLE "project_activity_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "actor_membership_id" UUID,
    "type" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID,
    "summary" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_decisions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source_conversation_id" UUID,
    "title" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "background" TEXT,
    "recommendation" TEXT,
    "conclusion" TEXT,
    "rationale" TEXT,
    "risks" JSONB NOT NULL DEFAULT '[]',
    "next_actions" JSONB NOT NULL DEFAULT '[]',
    "participant_membership_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" "ProjectDecisionStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "published_by_membership_id" UUID,
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "project_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_milestones" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "target_date" DATE NOT NULL,
    "owner_membership_id" UUID NOT NULL,
    "acceptance_criteria" JSONB NOT NULL DEFAULT '[]',
    "acceptance_note" TEXT,
    "status" "ProjectMilestoneStatus" NOT NULL DEFAULT 'PLANNED',
    "started_at" TIMESTAMP(3),
    "acceptance_started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "project_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_milestone_tasks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_milestone_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_milestone_decisions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "decision_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_milestone_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_repositories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "provider" "ProjectRepositoryProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "normalized_url" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL DEFAULT 'main',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "project_repositories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_activity_events_tenant_id_project_id_created_at_idx" ON "project_activity_events"("tenant_id", "project_id", "created_at");

-- CreateIndex
CREATE INDEX "project_activity_events_tenant_id_resource_type_resource_id_idx" ON "project_activity_events"("tenant_id", "resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "project_decisions_tenant_id_project_id_status_updated_at_idx" ON "project_decisions"("tenant_id", "project_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "project_decisions_tenant_id_created_by_membership_id_update_idx" ON "project_decisions"("tenant_id", "created_by_membership_id", "updated_at");

-- CreateIndex
CREATE INDEX "project_milestones_tenant_id_project_id_status_target_date_idx" ON "project_milestones"("tenant_id", "project_id", "status", "target_date");

-- CreateIndex
CREATE INDEX "project_milestones_tenant_id_owner_membership_id_target_dat_idx" ON "project_milestones"("tenant_id", "owner_membership_id", "target_date");

-- CreateIndex
CREATE INDEX "project_milestone_tasks_tenant_id_task_id_idx" ON "project_milestone_tasks"("tenant_id", "task_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_milestone_tasks_tenant_id_milestone_id_task_id_key" ON "project_milestone_tasks"("tenant_id", "milestone_id", "task_id");

-- CreateIndex
CREATE INDEX "project_milestone_decisions_tenant_id_decision_id_idx" ON "project_milestone_decisions"("tenant_id", "decision_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_milestone_decisions_tenant_id_milestone_id_decision_key" ON "project_milestone_decisions"("tenant_id", "milestone_id", "decision_id");

-- CreateIndex
CREATE INDEX "project_repositories_tenant_id_project_id_enabled_idx" ON "project_repositories"("tenant_id", "project_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "project_repositories_tenant_id_project_id_normalized_url_key" ON "project_repositories"("tenant_id", "project_id", "normalized_url");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_owner_membership_id_project_id_upda_idx" ON "conversations"("tenant_id", "owner_membership_id", "project_id", "updated_at");

-- AddForeignKey
ALTER TABLE "project_activity_events" ADD CONSTRAINT "project_activity_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_activity_events" ADD CONSTRAINT "project_activity_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_activity_events" ADD CONSTRAINT "project_activity_events_actor_membership_id_fkey" FOREIGN KEY ("actor_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_decisions" ADD CONSTRAINT "project_decisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_decisions" ADD CONSTRAINT "project_decisions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_decisions" ADD CONSTRAINT "project_decisions_source_conversation_id_fkey" FOREIGN KEY ("source_conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_decisions" ADD CONSTRAINT "project_decisions_published_by_membership_id_fkey" FOREIGN KEY ("published_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_decisions" ADD CONSTRAINT "project_decisions_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_owner_membership_id_fkey" FOREIGN KEY ("owner_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestone_tasks" ADD CONSTRAINT "project_milestone_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestone_tasks" ADD CONSTRAINT "project_milestone_tasks_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "project_milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestone_tasks" ADD CONSTRAINT "project_milestone_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestone_decisions" ADD CONSTRAINT "project_milestone_decisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestone_decisions" ADD CONSTRAINT "project_milestone_decisions_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "project_milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestone_decisions" ADD CONSTRAINT "project_milestone_decisions_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "project_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
