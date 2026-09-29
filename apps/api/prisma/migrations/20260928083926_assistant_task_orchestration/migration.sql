-- CreateEnum
CREATE TYPE "AssistantTaskStatus" AS ENUM ('CREATED', 'PENDING_CONFIRM', 'RUNNING', 'WAITING_USER', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssistantTaskOriginType" AS ENUM ('CONVERSATION', 'AGENT_CHAT', 'AUTO');

-- CreateEnum
CREATE TYPE "AssistantTaskPlanCreatedBy" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AssistantTaskStepStatus" AS ENUM ('PENDING', 'READY', 'RUNNING', 'WAITING_USER', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AssistantTaskEventType" AS ENUM ('TASK_CREATED', 'PLAN_READY', 'PLAN_CONFIRMED', 'STEP_STARTED', 'STEP_PROGRESS', 'STEP_COMPLETED', 'STEP_FAILED', 'STEP_SKIPPED', 'INTERACTION_REQUESTED', 'INTERACTION_RESOLVED', 'OUTPUT_CONFIRMED', 'TASK_COMPLETED', 'TASK_FAILED', 'TASK_CANCELLED');

-- CreateEnum
CREATE TYPE "AssistantTaskInteractionType" AS ENUM ('AUTHORIZATION', 'QUESTION', 'DECISION');

-- CreateEnum
CREATE TYPE "AssistantTaskInteractionStatus" AS ENUM ('PENDING', 'RESOLVED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssistantTaskInteractionScope" AS ENUM ('ONCE', 'TASK');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "agent_id" UUID;

-- CreateTable
CREATE TABLE "assistant_tasks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID,
    "user_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "origin_type" "AssistantTaskOriginType" NOT NULL DEFAULT 'CONVERSATION',
    "status" "AssistantTaskStatus" NOT NULL DEFAULT 'CREATED',
    "plan_version" INTEGER NOT NULL DEFAULT 0,
    "next_event_seq" INTEGER NOT NULL DEFAULT 1,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "execution_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "heartbeat_at" TIMESTAMP(3),
    "failed_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "assistant_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_task_plans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "steps" JSONB NOT NULL,
    "clarifications" JSONB,
    "created_by" "AssistantTaskPlanCreatedBy" NOT NULL DEFAULT 'SYSTEM',
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_task_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_task_steps" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "plan_version" INTEGER NOT NULL,
    "step_key" TEXT NOT NULL,
    "step_no" INTEGER NOT NULL,
    "assignee_agent_id" UUID NOT NULL,
    "brief" JSONB,
    "depends_on" JSONB NOT NULL DEFAULT '[]',
    "status" "AssistantTaskStepStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_no" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "output_refs" JSONB,
    "execution_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "heartbeat_at" TIMESTAMP(3),
    "error" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_task_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_task_step_messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" "ConversationMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "tool_call_ref" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_task_step_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_task_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" "AssistantTaskEventType" NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_task_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_task_interactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "step_id" UUID,
    "type" "AssistantTaskInteractionType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "AssistantTaskInteractionStatus" NOT NULL DEFAULT 'PENDING',
    "resolution" JSONB,
    "resolved_by_membership_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "scope" "AssistantTaskInteractionScope",
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_task_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_tasks_tenant_id_membership_id_created_at_idx" ON "assistant_tasks"("tenant_id", "membership_id", "created_at");

-- CreateIndex
CREATE INDEX "assistant_tasks_status_lease_expires_at_idx" ON "assistant_tasks"("status", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_tasks_conversation_id_idempotency_key_key" ON "assistant_tasks"("conversation_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_task_plans_task_id_version_key" ON "assistant_task_plans"("task_id", "version");

-- CreateIndex
CREATE INDEX "assistant_task_steps_status_lease_expires_at_idx" ON "assistant_task_steps"("status", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_task_steps_task_id_plan_version_step_key_key" ON "assistant_task_steps"("task_id", "plan_version", "step_key");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_task_step_messages_step_id_seq_key" ON "assistant_task_step_messages"("step_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_task_events_task_id_seq_key" ON "assistant_task_events"("task_id", "seq");

-- CreateIndex
CREATE INDEX "assistant_task_interactions_task_id_status_idx" ON "assistant_task_interactions"("task_id", "status");

-- CreateIndex
CREATE INDEX "assistant_task_interactions_status_expires_at_idx" ON "assistant_task_interactions"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "assistant_task_plans" ADD CONSTRAINT "assistant_task_plans_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "assistant_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_task_steps" ADD CONSTRAINT "assistant_task_steps_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "assistant_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_task_step_messages" ADD CONSTRAINT "assistant_task_step_messages_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "assistant_task_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_task_events" ADD CONSTRAINT "assistant_task_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "assistant_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_task_interactions" ADD CONSTRAINT "assistant_task_interactions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "assistant_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
