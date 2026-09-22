-- 修复「收支台账」页签对存量租户不可见的问题。
--
-- 背景：`20260921093000_role_based_dashboard_foundation` 建了 `finance_ledger_imports` /
-- `finance_ledger_entries` 两张表，也把 `finance.ledger.read` / `finance.ledger.manage`
-- 写进了 `src/rbac/permission-catalog.ts` 与财务控制器，但**漏了把这两个权限码授予
-- 既有租户的 `tenant_admin`**（对比 `0015_knowledge_base_management`、`0032_c_hr_fullstack`
-- 等迁移都有这一步）。结果是：
--   - 新建租户走 `seed.ts` / `platform-tenant.service.ts`，会按 TENANT_PERMISSION_DEFINITIONS
--     全量授予，页签正常；
--   - 存量租户的 `tenant_admin` 没有这两个权限，桌面端 `FinanceManagement` 的
--     `permissions.has('finance.ledger.read') || permissions.has('finance.ledger.manage')`
--     判定为 false，页签被整段隐藏。
--
-- 本迁移与既有迁移保持一致：注册权限码（幂等）→ 授予所有未删除的 `tenant_admin` 角色，
-- 依赖 `role_permissions(tenant_id, role_id, permission_id)` 唯一约束做幂等。

INSERT INTO "permissions" ("id", "code", "name", "created_at", "updated_at") VALUES
    (gen_random_uuid(), 'finance.ledger.read', '查看财务收支台账与收支看板', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'finance.ledger.manage', '上传、修订和回滚财务收支台账', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "tenant_id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."tenant_id", role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."code" = 'tenant_admin'
  AND role."deleted_at" IS NULL
  AND permission."code" IN ('finance.ledger.read', 'finance.ledger.manage')
ON CONFLICT ("tenant_id", "role_id", "permission_id") DO NOTHING;
