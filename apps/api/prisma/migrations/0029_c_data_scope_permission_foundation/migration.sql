-- Add C-owner permissions for assignment, cross-functional tasks, HR, finance and legal.
INSERT INTO permissions (id, code, name, created_at, updated_at) VALUES
    (gen_random_uuid(), 'assignment.policy.read', '查看分配策略', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'assignment.policy.manage', '管理分配策略', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task.cross_functional.create', '创建跨职能任务', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task.cross_functional.read', '查看跨职能任务', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task.cross_functional.update', '修改跨职能任务', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task.cross_functional.delete', '删除跨职能任务', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task.cross_functional.status.update', '变更跨职能任务状态', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task.cross_functional.assignee.manage', '管理跨职能任务执行人', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task.cross_functional.comment.create', '新增跨职能任务评论', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task.cross_functional.comment.update', '修改跨职能任务评论', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task.cross_functional.comment.delete', '删除跨职能任务评论', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task.cross_functional.attachment.manage', '管理跨职能任务附件', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'hr.profile.read', '查看员工档案', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'hr.profile.manage', '管理员工档案', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'hr.leave.read', '查看请假记录', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'hr.leave.request', '发起请假申请', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'hr.leave.approve', '审批请假申请', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'hr.leave.manage_all', '管理当前租户全部请假数据', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'finance.expense.read', '查看报销数据', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'finance.expense.request', '发起报销申请', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'finance.expense.approve', '审批报销申请', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'finance.expense.manage_all', '管理当前租户全部报销数据', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'legal.contract.read', '查看合同台账', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'legal.contract.create', '创建合同台账', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'legal.contract.update', '修改合同台账', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'legal.contract.delete', '删除合同台账', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'legal.contract.manage_all', '管理当前租户全部合同数据', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, updated_at = CURRENT_TIMESTAMP;

INSERT INTO role_permissions (id, tenant_id, role_id, permission_id, created_at)
SELECT gen_random_uuid(), role.tenant_id, role.id, permission.id, CURRENT_TIMESTAMP
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.code = 'tenant_admin'
  AND role.deleted_at IS NULL
  AND permission.code IN (
    'assignment.policy.read',
    'assignment.policy.manage',
    'task.cross_functional.create',
    'task.cross_functional.read',
    'task.cross_functional.update',
    'task.cross_functional.delete',
    'task.cross_functional.status.update',
    'task.cross_functional.assignee.manage',
    'task.cross_functional.comment.create',
    'task.cross_functional.comment.update',
    'task.cross_functional.comment.delete',
    'task.cross_functional.attachment.manage',
    'hr.profile.read',
    'hr.profile.manage',
    'hr.leave.read',
    'hr.leave.request',
    'hr.leave.approve',
    'hr.leave.manage_all',
    'finance.expense.read',
    'finance.expense.request',
    'finance.expense.approve',
    'finance.expense.manage_all',
    'legal.contract.read',
    'legal.contract.create',
    'legal.contract.update',
    'legal.contract.delete',
    'legal.contract.manage_all'
  )
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;
