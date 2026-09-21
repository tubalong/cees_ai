ALTER TABLE "tasks" ADD COLUMN "completed_at" TIMESTAMP(3);

CREATE INDEX "tasks_tenant_id_completed_at_idx"
ON "tasks"("tenant_id", "completed_at");

CREATE INDEX "tasks_tenant_id_project_id_completed_at_idx"
ON "tasks"("tenant_id", "project_id", "completed_at");

UPDATE "tasks" AS task
SET "completed_at" = status_change."created_at"
FROM (
  SELECT DISTINCT ON ("task_id") "task_id", "created_at"
  FROM "task_activities"
  WHERE "action" = 'TASK_STATUS_CHANGED'
    AND "metadata"->>'toStatus' = 'DONE'
  ORDER BY "task_id", "created_at" DESC
) AS status_change
WHERE task."id" = status_change."task_id"
  AND task."status" = 'DONE'
  AND task."completed_at" IS NULL;