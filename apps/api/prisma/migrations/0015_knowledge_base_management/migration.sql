INSERT INTO permissions (id, code, name, created_at, updated_at)
VALUES
    (gen_random_uuid(), 'knowledge_base.create', '创建知识库', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'knowledge_base.read', '查看可访问的知识库', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'knowledge_base.update', '修改可访问的知识库', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'knowledge_base.delete', '删除可访问的知识库', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'knowledge_base.member.manage', '管理知识库成员', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'knowledge_base.document.manage', '管理知识库文档', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'knowledge_base.query', '查询知识库内容', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'knowledge_base.manage_all', '管理当前租户全部知识库', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name, updated_at = CURRENT_TIMESTAMP;

INSERT INTO role_permissions (id, tenant_id, role_id, permission_id, created_at)
SELECT
    gen_random_uuid(),
    role.tenant_id,
    role.id,
    permission.id,
    CURRENT_TIMESTAMP
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.code = 'tenant_admin'
  AND role.is_system = true
  AND role.deleted_at IS NULL
  AND permission.code LIKE 'knowledge_base.%'
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

COMMENT ON TABLE knowledge_bases IS '租户知识库主表，保存知识库名称、说明、版本和生命周期。';
COMMENT ON COLUMN knowledge_bases.name IS '知识库名称。';
COMMENT ON COLUMN knowledge_bases.description IS '知识库说明，可为空。';
COMMENT ON TABLE knowledge_base_members IS '知识库成员授权关系，按租户和 User 授予读取、编辑或管理权限。';
COMMENT ON COLUMN knowledge_base_members.permission IS '知识库成员权限：READER、EDITOR 或 MANAGER。';
