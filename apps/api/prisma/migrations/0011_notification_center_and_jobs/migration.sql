ALTER TABLE "notifications"
    ADD COLUMN "dedup_key" TEXT;

ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notification_recipients"
    ADD CONSTRAINT "notification_recipients_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "notification_recipients_notification_id_fkey"
    FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "notification_recipients_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "notifications_tenant_id_dedup_key_key"
    ON "notifications"("tenant_id", "dedup_key");
CREATE INDEX "notification_recipients_tenant_id_user_id_read_at_created_at_idx"
    ON "notification_recipients"("tenant_id", "user_id", "read_at", "created_at");
CREATE INDEX "notification_recipients_tenant_id_notification_id_idx"
    ON "notification_recipients"("tenant_id", "notification_id");

INSERT INTO "permissions" ("id", "code", "name", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'notification.read', '查看通知中心', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "tenant_id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."tenant_id", role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."deleted_at" IS NULL
  AND permission."code" = 'notification.read'
ON CONFLICT ("tenant_id", "role_id", "permission_id") DO NOTHING;

COMMENT ON TABLE "notifications" IS '租户通知主表';
COMMENT ON COLUMN "notifications"."id" IS '通知 UUID';
COMMENT ON COLUMN "notifications"."tenant_id" IS '所属租户 UUID';
COMMENT ON COLUMN "notifications"."title" IS '通知标题';
COMMENT ON COLUMN "notifications"."content" IS '通知正文';
COMMENT ON COLUMN "notifications"."channel" IS '通知渠道，当前默认 IN_APP';
COMMENT ON COLUMN "notifications"."relation_type" IS '关联业务资源类型';
COMMENT ON COLUMN "notifications"."relation_id" IS '关联业务资源 UUID，可空';
COMMENT ON COLUMN "notifications"."dedup_key" IS '租户内通知幂等去重键';
COMMENT ON COLUMN "notifications"."created_at" IS '创建时间';
COMMENT ON COLUMN "notifications"."updated_at" IS '最后更新时间';
COMMENT ON COLUMN "notifications"."created_by" IS '创建人全局 User UUID，可空';
COMMENT ON COLUMN "notifications"."updated_by" IS '最后更新人全局 User UUID，可空';
COMMENT ON COLUMN "notifications"."deleted_at" IS '软删除时间';
COMMENT ON COLUMN "notifications"."version" IS '通知乐观锁版本号';

COMMENT ON TABLE "notification_recipients" IS '通知接收人与阅读状态表';
COMMENT ON COLUMN "notification_recipients"."id" IS '通知接收关系 UUID';
COMMENT ON COLUMN "notification_recipients"."tenant_id" IS '所属租户 UUID';
COMMENT ON COLUMN "notification_recipients"."notification_id" IS '通知 UUID';
COMMENT ON COLUMN "notification_recipients"."user_id" IS '接收人全局 User UUID';
COMMENT ON COLUMN "notification_recipients"."read_at" IS '当前接收人阅读时间，未读时为空';
COMMENT ON COLUMN "notification_recipients"."created_at" IS '投递时间';
