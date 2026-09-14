-- 存量角色统一补齐默认 AI 权限：所有未删除角色都拥有
-- 图片/文档的生成与查看权限，与新建角色的默认权限（DEFAULT_ROLE_PERMISSION_CODES）一致。
INSERT INTO "role_permissions" ("id", "tenant_id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."tenant_id", role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."deleted_at" IS NULL
  AND permission."code" IN ('image.read', 'document.read', 'ai.image.generate', 'ai.document.generate')
ON CONFLICT ("tenant_id", "role_id", "permission_id") DO NOTHING;
