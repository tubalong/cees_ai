-- Register field-level HR profile permissions and grant them to existing tenant administrators.
INSERT INTO permissions (id, code, name, created_at, updated_at) VALUES
    (gen_random_uuid(), 'hr.profile.sensitive.read', '查看员工敏感档案字段', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'hr.profile.sensitive.manage', '管理员工敏感档案字段', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, updated_at = CURRENT_TIMESTAMP;

INSERT INTO role_permissions (id, tenant_id, role_id, permission_id, created_at)
SELECT gen_random_uuid(), role.tenant_id, role.id, permission.id, CURRENT_TIMESTAMP
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.code = 'tenant_admin'
  AND role.deleted_at IS NULL
  AND permission.code IN (
    'hr.profile.sensitive.read',
    'hr.profile.sensitive.manage'
  )
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;
