INSERT INTO permissions (id, code, name, created_at, updated_at)
VALUES (gen_random_uuid(), 'dashboard.read', '查看工作台和数据看板', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, updated_at = CURRENT_TIMESTAMP;

INSERT INTO role_permissions (id, tenant_id, role_id, permission_id, created_at)
SELECT gen_random_uuid(), role.tenant_id, role.id, permission.id, CURRENT_TIMESTAMP
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.deleted_at IS NULL
  AND permission.code = 'dashboard.read'
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;
