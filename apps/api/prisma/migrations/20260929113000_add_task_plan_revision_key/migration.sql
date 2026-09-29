-- AlterEnum
ALTER TYPE "AssistantTaskEventType" ADD VALUE 'PLAN_REVISION_REQUESTED';

-- AlterTable
ALTER TABLE "assistant_task_plans" ADD COLUMN     "revision_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "assistant_task_plans_task_id_revision_key_key" ON "assistant_task_plans"("task_id", "revision_key");
