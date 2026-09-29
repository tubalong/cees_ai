-- 存量角色补齐 AI 编排任务权限（ai.task.create / ai.task.read）。
--
-- 背景：AI 编排任务权限码加入 src/rbac/permission-catalog.ts 的
-- TENANT_PERMISSION_DEFINITIONS 与 DEFAULT_ROLE_PERMISSION_CODES（新建租户经
-- seed.ts / platform-tenant.service.ts 全量授予，新建角色按默认集授予）。
-- 存量租户若不补齐，任务列表与发起能力将因权限判定失败而不可用。
--
-- 本迁移与 `20260920055850_role_default_knowledge_base_read` 保持一致：
-- 注册权限码（幂等，名称可更新）→ 授予所有未删除角色；
-- 依赖 `role_permissions(tenant_id, role_id, permission_id)` 唯一约束做幂等。

INSERT INTO "permissions" ("id", "code", "name", "created_at", "updated_at") VALUES
    (gen_random_uuid(), 'ai.task.create', '发起 AI 编排任务', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'ai.task.read', '查看 AI 编排任务', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "tenant_id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."tenant_id", role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."deleted_at" IS NULL
  AND permission."code" IN ('ai.task.create', 'ai.task.read')
ON CONFLICT ("tenant_id", "role_id", "permission_id") DO NOTHING;
