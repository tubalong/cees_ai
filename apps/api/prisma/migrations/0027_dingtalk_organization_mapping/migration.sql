-- 钉钉组织映射权限：预览和应用均由租户管理员控制。
INSERT INTO "permissions" ("id", "code", "name", "created_at", "updated_at")
VALUES
    (gen_random_uuid(), 'dingtalk.organization.mapping.preview', '预览钉钉组织映射', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'dingtalk.organization.mapping.manage', '应用钉钉组织映射', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name", "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "tenant_id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."tenant_id", role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."code" = 'tenant_admin'
  AND role."deleted_at" IS NULL
  AND permission."code" IN ('dingtalk.organization.mapping.preview', 'dingtalk.organization.mapping.manage')
ON CONFLICT ("tenant_id", "role_id", "permission_id") DO NOTHING;
