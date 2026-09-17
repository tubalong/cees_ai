-- DropForeignKey
ALTER TABLE "notification_recipients" DROP CONSTRAINT "notification_recipients_notification_id_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_parent_id_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_project_id_fkey";

-- AlterTable
ALTER TABLE "assistant_events" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "assistant_turns" ADD COLUMN     "knowledge_base_enabled" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "conversation_messages" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "conversation_summaries" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "conversations" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "dingtalk_departments" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "dingtalk_integrations" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "dingtalk_sync_jobs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "dingtalk_users" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "knowledge_query_logs" ALTER COLUMN "knowledge_base_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "tool_calls" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "work_report_projects" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "work_report_tasks" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "work_reports" ALTER COLUMN "id" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "notification_recipients_tenant_id_user_id_read_at_created_at_id" RENAME TO "notification_recipients_tenant_id_user_id_read_at_created_a_idx";

-- RenameIndex
ALTER INDEX "work_reports_tenant_id_reviewer_membership_id_status_submitted_" RENAME TO "work_reports_tenant_id_reviewer_membership_id_status_submit_idx";
