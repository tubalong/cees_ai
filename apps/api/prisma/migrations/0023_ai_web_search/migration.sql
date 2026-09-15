-- 联网搜索能力：由 NestJS 统一执行、权限控制和审计，ai-service 只负责模型 Tool Calling。
INSERT INTO "permissions" ("id", "code", "name", "created_at", "updated_at")
VALUES
    (gen_random_uuid(), 'ai.web.search', '使用 AI 联网搜索公开资料', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name", "updated_at" = CURRENT_TIMESTAMP;

-- 首版只默认授予系统租户管理员；其他角色由管理员在 RBAC 中显式授予。
INSERT INTO "role_permissions" ("id", "tenant_id", "role_id", "permission_id", "created_at")
SELECT
    gen_random_uuid(),
    role."tenant_id",
    role."id",
    permission."id",
    CURRENT_TIMESTAMP
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."code" = 'tenant_admin'
  AND role."is_system" = true
  AND role."deleted_at" IS NULL
  AND permission."code" = 'ai.web.search'
ON CONFLICT ("tenant_id", "role_id", "permission_id") DO NOTHING;
