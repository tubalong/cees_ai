-- 存量角色统一补齐默认知识库读取权限：所有未删除角色都拥有 knowledge_base.read，
-- 与新建角色的默认权限（DEFAULT_ROLE_PERMISSION_CODES，2026-09-20 起含知识库读取）一致。
-- document.read 等其余默认权限已由 0022_role_default_ai_permissions 补齐，此处仅补新增项。
INSERT INTO "role_permissions" ("id", "tenant_id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."tenant_id", role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."deleted_at" IS NULL
  AND permission."code" = 'knowledge_base.read'
ON CONFLICT ("tenant_id", "role_id", "permission_id") DO NOTHING;
