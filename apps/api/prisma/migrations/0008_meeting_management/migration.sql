CREATE TYPE "MeetingStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "MeetingParticipantRole" AS ENUM ('HOST', 'RECORDER', 'PARTICIPANT');
CREATE TYPE "MeetingResponseStatus" AS ENUM ('INVITED', 'ACCEPTED', 'DECLINED', 'TENTATIVE');
CREATE TYPE "MeetingAttendanceStatus" AS ENUM ('PENDING', 'ATTENDED', 'ABSENT');
CREATE TYPE "MeetingMinutesStatus" AS ENUM ('DRAFT', 'PUBLISHED');

ALTER TABLE "meetings"
    ADD COLUMN "project_id" UUID,
    ADD COLUMN "organizer_membership_id" UUID,
    ADD COLUMN "description" TEXT,
    ADD COLUMN "location" TEXT,
    ADD COLUMN "meeting_url" TEXT,
    ADD COLUMN "status" "MeetingStatus" NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN "cancel_reason" TEXT,
    ADD COLUMN "started_at" TIMESTAMP(3),
    ADD COLUMN "completed_at" TIMESTAMP(3);

UPDATE "meetings" AS meeting
SET "organizer_membership_id" = (
    SELECT membership."id"
    FROM "tenant_memberships" AS membership
    WHERE membership."tenant_id" = meeting."tenant_id"
      AND membership."deleted_at" IS NULL
    ORDER BY
        CASE WHEN membership."user_id" = meeting."created_by" THEN 0 ELSE 1 END,
        membership."created_at",
        membership."id"
    LIMIT 1
)
WHERE meeting."organizer_membership_id" IS NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "meetings" WHERE "organizer_membership_id" IS NULL) THEN
        RAISE EXCEPTION '0008_meeting_management: legacy meeting has no tenant membership available for organizer mapping';
    END IF;
END $$;

UPDATE "meetings" SET "agenda" = '[]'::jsonb WHERE "agenda" IS NULL;

ALTER TABLE "meetings"
    ALTER COLUMN "organizer_membership_id" SET NOT NULL,
    ALTER COLUMN "agenda" SET NOT NULL;

ALTER TABLE "meeting_participants"
    ADD COLUMN "membership_id" UUID,
    ADD COLUMN "role" "MeetingParticipantRole" NOT NULL DEFAULT 'PARTICIPANT',
    ADD COLUMN "response_status" "MeetingResponseStatus" NOT NULL DEFAULT 'INVITED',
    ADD COLUMN "attendance_status" "MeetingAttendanceStatus" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "responded_at" TIMESTAMP(3),
    ADD COLUMN "updated_at" TIMESTAMP(3),
    ADD COLUMN "created_by" UUID,
    ADD COLUMN "updated_by" UUID,
    ADD COLUMN "deleted_at" TIMESTAMP(3),
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "meeting_participants" AS participant
SET "membership_id" = membership."id"
FROM "tenant_memberships" AS membership
WHERE membership."tenant_id" = participant."tenant_id"
  AND membership."user_id" = participant."user_id";

UPDATE "meeting_participants"
SET
    "response_status" = CASE "status"
        WHEN 'ACCEPTED' THEN 'ACCEPTED'::"MeetingResponseStatus"
        WHEN 'DECLINED' THEN 'DECLINED'::"MeetingResponseStatus"
        WHEN 'TENTATIVE' THEN 'TENTATIVE'::"MeetingResponseStatus"
        ELSE 'INVITED'::"MeetingResponseStatus"
    END,
    "responded_at" = CASE WHEN "status" IN ('ACCEPTED', 'DECLINED', 'TENTATIVE') THEN "created_at" ELSE NULL END,
    "updated_at" = "created_at";

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "meeting_participants" WHERE "membership_id" IS NULL) THEN
        RAISE EXCEPTION '0008_meeting_management: legacy meeting participant cannot be mapped to tenant membership';
    END IF;
END $$;

DROP INDEX "meeting_participants_tenant_id_meeting_id_user_id_key";

ALTER TABLE "meeting_participants"
    ALTER COLUMN "membership_id" SET NOT NULL,
    ALTER COLUMN "updated_at" SET NOT NULL,
    DROP COLUMN "status",
    DROP COLUMN "user_id";

ALTER TABLE "meeting_minutes"
    ADD COLUMN "recorder_membership_id" UUID,
    ADD COLUMN "published_at" TIMESTAMP(3),
    ADD COLUMN "published_by_membership_id" UUID;

UPDATE "meeting_minutes" AS minutes
SET "recorder_membership_id" = membership."id"
FROM "tenant_memberships" AS membership
WHERE membership."tenant_id" = minutes."tenant_id"
  AND membership."user_id" = minutes."created_by";

ALTER TABLE "meeting_minutes" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "meeting_minutes"
    ALTER COLUMN "status" TYPE "MeetingMinutesStatus"
    USING CASE
        WHEN "status" = 'PUBLISHED' THEN 'PUBLISHED'::"MeetingMinutesStatus"
        ELSE 'DRAFT'::"MeetingMinutesStatus"
    END;
ALTER TABLE "meeting_minutes" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

UPDATE "meeting_minutes" AS minutes
SET
    "published_at" = CASE WHEN minutes."status" = 'PUBLISHED' THEN minutes."updated_at" ELSE NULL END,
    "published_by_membership_id" = CASE WHEN minutes."status" = 'PUBLISHED' THEN membership."id" ELSE NULL END
FROM "tenant_memberships" AS membership
WHERE membership."tenant_id" = minutes."tenant_id"
  AND membership."user_id" = minutes."updated_by";

DO $$
BEGIN
    IF EXISTS (
        SELECT "meeting_id"
        FROM "meeting_minutes"
        GROUP BY "meeting_id"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION '0008_meeting_management: a meeting has multiple legacy meeting minutes rows';
    END IF;
END $$;

CREATE UNIQUE INDEX "meeting_minutes_meeting_id_key" ON "meeting_minutes"("meeting_id");
CREATE INDEX "meeting_minutes_tenant_id_status_updated_at_idx" ON "meeting_minutes"("tenant_id", "status", "updated_at");
CREATE UNIQUE INDEX "meeting_participants_tenant_id_meeting_id_membership_id_key"
    ON "meeting_participants"("tenant_id", "meeting_id", "membership_id");
CREATE INDEX "meeting_participants_tenant_id_membership_id_created_at_idx"
    ON "meeting_participants"("tenant_id", "membership_id", "created_at");
CREATE INDEX "meeting_participants_tenant_id_meeting_id_role_idx"
    ON "meeting_participants"("tenant_id", "meeting_id", "role");
CREATE INDEX "meetings_tenant_id_status_starts_at_idx" ON "meetings"("tenant_id", "status", "starts_at");
CREATE INDEX "meetings_tenant_id_organizer_membership_id_starts_at_idx"
    ON "meetings"("tenant_id", "organizer_membership_id", "starts_at");
CREATE INDEX "meetings_tenant_id_project_id_starts_at_idx" ON "meetings"("tenant_id", "project_id", "starts_at");
CREATE INDEX "meetings_tenant_id_department_id_starts_at_idx" ON "meetings"("tenant_id", "department_id", "starts_at");

ALTER TABLE "meetings"
    ADD CONSTRAINT "meetings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "meetings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "meetings_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "meetings_organizer_membership_id_fkey" FOREIGN KEY ("organizer_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "meeting_participants"
    ADD CONSTRAINT "meeting_participants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "meeting_participants_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "meeting_participants_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "meeting_minutes"
    ADD CONSTRAINT "meeting_minutes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "meeting_minutes_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "meeting_minutes_recorder_membership_id_fkey" FOREIGN KEY ("recorder_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "meeting_minutes_published_by_membership_id_fkey" FOREIGN KEY ("published_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "code", "name", "created_at", "updated_at") VALUES
    (gen_random_uuid(), 'meeting.create', '创建会议', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'meeting.read', '查看会议', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'meeting.update', '修改会议资料', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'meeting.delete', '删除会议草稿', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'meeting.status.update', '变更会议状态', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'meeting.participant.manage', '管理会议参会人', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'meeting.minutes.manage', '管理会议纪要', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'meeting.manage_all', '管理当前租户全部会议', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "tenant_id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."tenant_id", role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."code" = 'tenant_admin'
  AND role."deleted_at" IS NULL
  AND permission."code" IN (
      'meeting.create', 'meeting.read', 'meeting.update', 'meeting.delete',
      'meeting.status.update', 'meeting.participant.manage', 'meeting.minutes.manage', 'meeting.manage_all'
  )
ON CONFLICT ("tenant_id", "role_id", "permission_id") DO NOTHING;

COMMENT ON TYPE "MeetingStatus" IS '会议状态：草稿、已安排、进行中、已完成或已取消';
COMMENT ON TYPE "MeetingParticipantRole" IS '会议参会角色：主持人、记录人或普通参会人';
COMMENT ON TYPE "MeetingResponseStatus" IS '参会邀请应答状态';
COMMENT ON TYPE "MeetingAttendanceStatus" IS '会议实际出席状态';
COMMENT ON TYPE "MeetingMinutesStatus" IS '会议纪要状态：草稿或已发布';

COMMENT ON TABLE "meetings" IS '租户会议主表，保存会议资料、组织者、状态和关联项目部门。';
COMMENT ON COLUMN "meetings"."id" IS '会议 UUID';
COMMENT ON COLUMN "meetings"."tenant_id" IS '所属租户 UUID';
COMMENT ON COLUMN "meetings"."project_id" IS '关联项目 UUID，可空';
COMMENT ON COLUMN "meetings"."department_id" IS '会议归属部门 UUID，可空，不自动授予部门成员访问权';
COMMENT ON COLUMN "meetings"."organizer_membership_id" IS '会议组织者对应的租户成员 UUID';
COMMENT ON COLUMN "meetings"."title" IS '会议标题';
COMMENT ON COLUMN "meetings"."description" IS '会议说明';
COMMENT ON COLUMN "meetings"."starts_at" IS '计划开始时间';
COMMENT ON COLUMN "meetings"."duration_minutes" IS '计划时长，单位分钟';
COMMENT ON COLUMN "meetings"."location" IS '线下会议地点';
COMMENT ON COLUMN "meetings"."meeting_url" IS '在线会议地址，仅保存链接，不集成第三方会议平台';
COMMENT ON COLUMN "meetings"."agenda" IS '结构化会议议程 JSON 数组';
COMMENT ON COLUMN "meetings"."status" IS '会议状态 MeetingStatus';
COMMENT ON COLUMN "meetings"."cancel_reason" IS '会议取消原因，仅 CANCELLED 使用';
COMMENT ON COLUMN "meetings"."started_at" IS '实际开始时间';
COMMENT ON COLUMN "meetings"."completed_at" IS '实际完成时间';
COMMENT ON COLUMN "meetings"."created_at" IS '创建时间';
COMMENT ON COLUMN "meetings"."updated_at" IS '最后更新时间';
COMMENT ON COLUMN "meetings"."created_by" IS '创建者 User UUID';
COMMENT ON COLUMN "meetings"."updated_by" IS '最后修改者 User UUID';
COMMENT ON COLUMN "meetings"."deleted_at" IS '软删除时间，仅草稿会议允许删除';
COMMENT ON COLUMN "meetings"."version" IS '会议乐观锁版本';

COMMENT ON TABLE "meeting_participants" IS '会议与租户成员的参会关系，保存角色、邀请应答和实际出席状态。';
COMMENT ON COLUMN "meeting_participants"."id" IS '会议参会关系 UUID';
COMMENT ON COLUMN "meeting_participants"."tenant_id" IS '所属租户 UUID';
COMMENT ON COLUMN "meeting_participants"."meeting_id" IS '会议 UUID';
COMMENT ON COLUMN "meeting_participants"."membership_id" IS '参会人对应的租户成员 UUID';
COMMENT ON COLUMN "meeting_participants"."role" IS '参会角色 MeetingParticipantRole';
COMMENT ON COLUMN "meeting_participants"."response_status" IS '参会邀请应答状态 MeetingResponseStatus';
COMMENT ON COLUMN "meeting_participants"."attendance_status" IS '实际出席状态 MeetingAttendanceStatus';
COMMENT ON COLUMN "meeting_participants"."responded_at" IS '最近一次邀请应答时间';
COMMENT ON COLUMN "meeting_participants"."created_at" IS '创建时间';
COMMENT ON COLUMN "meeting_participants"."updated_at" IS '最后更新时间';
COMMENT ON COLUMN "meeting_participants"."created_by" IS '创建者 User UUID';
COMMENT ON COLUMN "meeting_participants"."updated_by" IS '最后修改者 User UUID';
COMMENT ON COLUMN "meeting_participants"."deleted_at" IS '移出会议时间';
COMMENT ON COLUMN "meeting_participants"."version" IS '参会关系乐观锁版本';

COMMENT ON TABLE "meeting_minutes" IS '会议正式纪要表，每场会议最多一份有效纪要，通过状态区分草稿和发布。';
COMMENT ON COLUMN "meeting_minutes"."id" IS '会议纪要 UUID';
COMMENT ON COLUMN "meeting_minutes"."tenant_id" IS '所属租户 UUID';
COMMENT ON COLUMN "meeting_minutes"."meeting_id" IS '会议 UUID，每场会议唯一';
COMMENT ON COLUMN "meeting_minutes"."content" IS '结构化纪要 JSON，包含摘要、决策、行动项和补充记录';
COMMENT ON COLUMN "meeting_minutes"."status" IS '会议纪要状态 MeetingMinutesStatus';
COMMENT ON COLUMN "meeting_minutes"."recorder_membership_id" IS '最近保存纪要的租户成员 UUID';
COMMENT ON COLUMN "meeting_minutes"."published_at" IS '最近发布时间';
COMMENT ON COLUMN "meeting_minutes"."published_by_membership_id" IS '最近发布纪要的租户成员 UUID';
COMMENT ON COLUMN "meeting_minutes"."created_at" IS '创建时间';
COMMENT ON COLUMN "meeting_minutes"."updated_at" IS '最后更新时间';
COMMENT ON COLUMN "meeting_minutes"."created_by" IS '创建者 User UUID';
COMMENT ON COLUMN "meeting_minutes"."updated_by" IS '最后修改者 User UUID';
COMMENT ON COLUMN "meeting_minutes"."deleted_at" IS '预留软删除时间';
COMMENT ON COLUMN "meeting_minutes"."version" IS '会议纪要乐观锁版本';
