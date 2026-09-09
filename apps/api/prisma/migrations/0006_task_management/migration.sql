CREATE TYPE "TaskAssigneeType" AS ENUM ('OWNER', 'COLLABORATOR');

ALTER TABLE "task_assignees" ADD COLUMN "membership_id" UUID;

UPDATE "task_assignees" AS assignee
SET "membership_id" = membership."id"
FROM "tenant_memberships" AS membership
WHERE membership."tenant_id" = assignee."tenant_id"
  AND membership."user_id" = assignee."user_id";

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "task_assignees" WHERE "membership_id" IS NULL) THEN
        RAISE EXCEPTION 'task_assignees contains user_id values without a matching tenant_membership';
    END IF;
END $$;

ALTER TABLE "task_assignees"
    ALTER COLUMN "membership_id" SET NOT NULL,
    ALTER COLUMN "assignee_type" DROP DEFAULT,
    ALTER COLUMN "assignee_type" TYPE "TaskAssigneeType"
        USING CASE
            WHEN "assignee_type" = 'OWNER' THEN 'OWNER'::"TaskAssigneeType"
            ELSE 'COLLABORATOR'::"TaskAssigneeType"
        END,
    ALTER COLUMN "assignee_type" SET DEFAULT 'OWNER',
    DROP COLUMN "user_id";

ALTER TABLE "tasks" ADD COLUMN "created_by_membership_id" UUID;
ALTER TABLE "task_comments" ADD COLUMN "author_membership_id" UUID;
ALTER TABLE "task_attachments" ADD COLUMN "created_by_membership_id" UUID;
ALTER TABLE "task_activities" ADD COLUMN "actor_membership_id" UUID;

UPDATE "tasks" AS task
SET "created_by_membership_id" = membership."id"
FROM "tenant_memberships" AS membership
WHERE membership."tenant_id" = task."tenant_id"
  AND membership."user_id" = task."created_by";

UPDATE "task_comments" AS comment
SET "author_membership_id" = membership."id"
FROM "tenant_memberships" AS membership
WHERE membership."tenant_id" = comment."tenant_id"
  AND membership."user_id" = comment."created_by";

UPDATE "task_attachments" AS attachment
SET "created_by_membership_id" = membership."id"
FROM "tenant_memberships" AS membership
WHERE membership."tenant_id" = attachment."tenant_id"
  AND membership."user_id" = attachment."created_by";

UPDATE "task_activities" AS activity
SET "actor_membership_id" = membership."id"
FROM "tenant_memberships" AS membership
WHERE membership."tenant_id" = activity."tenant_id"
  AND membership."user_id" = activity."created_by";

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "task_comments" WHERE "author_membership_id" IS NULL) THEN
        RAISE EXCEPTION 'task_comments contains rows without a matching author tenant_membership';
    END IF;
    IF EXISTS (SELECT 1 FROM "task_attachments" WHERE "created_by_membership_id" IS NULL) THEN
        RAISE EXCEPTION 'task_attachments contains rows without a matching creator tenant_membership';
    END IF;
END $$;

ALTER TABLE "task_comments" ALTER COLUMN "author_membership_id" SET NOT NULL;
ALTER TABLE "task_attachments" ALTER COLUMN "created_by_membership_id" SET NOT NULL;

DROP INDEX IF EXISTS "task_assignees_tenant_id_task_id_user_id_key";
DROP INDEX IF EXISTS "task_assignees_tenant_id_user_id_idx";
DROP INDEX IF EXISTS "task_comments_tenant_id_task_id_idx";
DROP INDEX IF EXISTS "task_activities_tenant_id_task_id_idx";

CREATE UNIQUE INDEX "task_assignees_tenant_id_task_id_membership_id_key"
    ON "task_assignees"("tenant_id", "task_id", "membership_id");
CREATE UNIQUE INDEX "task_assignees_one_owner_key"
    ON "task_assignees"("tenant_id", "task_id") WHERE "assignee_type" = 'OWNER';
CREATE INDEX "task_assignees_tenant_id_membership_id_idx"
    ON "task_assignees"("tenant_id", "membership_id");
CREATE INDEX "task_assignees_tenant_id_task_id_assignee_type_idx"
    ON "task_assignees"("tenant_id", "task_id", "assignee_type");
CREATE INDEX "tasks_tenant_id_project_id_parent_id_idx"
    ON "tasks"("tenant_id", "project_id", "parent_id");
CREATE INDEX "tasks_tenant_id_created_by_membership_id_idx"
    ON "tasks"("tenant_id", "created_by_membership_id");
CREATE INDEX "task_comments_tenant_id_task_id_created_at_idx"
    ON "task_comments"("tenant_id", "task_id", "created_at");
CREATE INDEX "task_comments_tenant_id_author_membership_id_idx"
    ON "task_comments"("tenant_id", "author_membership_id");
CREATE INDEX "task_attachments_tenant_id_file_object_id_idx"
    ON "task_attachments"("tenant_id", "file_object_id");
CREATE INDEX "task_attachments_tenant_id_created_by_membership_id_idx"
    ON "task_attachments"("tenant_id", "created_by_membership_id");
CREATE UNIQUE INDEX "task_attachments_active_file_key"
    ON "task_attachments"("tenant_id", "task_id", "file_object_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "task_activities_tenant_id_task_id_created_at_idx"
    ON "task_activities"("tenant_id", "task_id", "created_at");
CREATE INDEX "task_activities_tenant_id_actor_membership_id_idx"
    ON "task_activities"("tenant_id", "actor_membership_id");

ALTER TABLE "tasks"
    ADD CONSTRAINT "tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "tasks_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "tasks_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "task_assignees"
    ADD CONSTRAINT "task_assignees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "task_assignees_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "task_assignees_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_comments"
    ADD CONSTRAINT "task_comments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "task_comments_author_membership_id_fkey" FOREIGN KEY ("author_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_attachments"
    ADD CONSTRAINT "task_attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "task_attachments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "task_attachments_file_object_id_fkey" FOREIGN KEY ("file_object_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "task_attachments_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_activities"
    ADD CONSTRAINT "task_activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "task_activities_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "task_activities_actor_membership_id_fkey" FOREIGN KEY ("actor_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "code", "name", "created_at", "updated_at") VALUES
    (gen_random_uuid(), 'task.create', '创建项目任务', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task.read', '查看项目任务', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task.update', '修改项目任务', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task.delete', '删除项目任务', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task.status.update', '变更任务状态', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task.assignee.manage', '管理任务负责人和协作人', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task.comment.create', '新增任务评论', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task.comment.update', '修改任务评论', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task.comment.delete', '删除任务评论', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task.attachment.manage', '管理任务附件', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "tenant_id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."tenant_id", role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."code" = 'tenant_admin'
  AND role."deleted_at" IS NULL
  AND permission."code" IN (
      'task.create', 'task.read', 'task.update', 'task.delete', 'task.status.update',
      'task.assignee.manage', 'task.comment.create', 'task.comment.update',
      'task.comment.delete', 'task.attachment.manage'
  )
ON CONFLICT ("tenant_id", "role_id", "permission_id") DO NOTHING;

COMMENT ON TYPE "TaskAssigneeType" IS '任务执行人类型：唯一负责人或协作人';
COMMENT ON COLUMN "tasks"."created_by_membership_id" IS '创建任务的租户成员 UUID';
COMMENT ON COLUMN "task_assignees"."membership_id" IS '被分配任务的租户成员 UUID，不使用全局 User UUID';
COMMENT ON COLUMN "task_assignees"."assignee_type" IS '任务执行人类型：OWNER 或 COLLABORATOR';
COMMENT ON COLUMN "task_comments"."author_membership_id" IS '评论作者对应的租户成员 UUID';
COMMENT ON COLUMN "task_attachments"."created_by_membership_id" IS '添加附件的租户成员 UUID';
COMMENT ON COLUMN "task_activities"."actor_membership_id" IS '执行任务动作的租户成员 UUID，可空表示系统动作';
