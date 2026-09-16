import { CheckOutlined, FileExcelOutlined, ReloadOutlined, TeamOutlined } from '@ant-design/icons';
import { Alert, App as AntdApp, Button, Checkbox, Empty, Modal, Spin, Table, Tag } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
    applyDingTalkMapping,
    hasStoredSession,
    listTenantRoles,
    previewDingTalkMapping,
    type DingTalkMappingCredential,
    type DingTalkMappingUserPreview,
    type DingTalkRoleAssignment,
    type MeResult,
} from '../../core/api';
import { useI18n } from '../../core/i18n';

interface DingTalkMappingModalProps {
    open: boolean;
    authContext: MeResult;
    onClose: () => void;
    onSessionExpired: () => void;
    onApplied: () => void;
}

type RoleSelections = Record<string, string[]>;

export default function DingTalkMappingModal({ open, authContext, onClose, onSessionExpired, onApplied }: DingTalkMappingModalProps): JSX.Element {
    const { t } = useI18n();
    const { message } = AntdApp.useApp();
    const [selectedRoleId, setSelectedRoleId] = useState<string>();
    const [roleSelections, setRoleSelections] = useState<RoleSelections>({});
    const [credentials, setCredentials] = useState<DingTalkMappingCredential[]>();
    const permissions = new Set(authContext.permissions);
    const canReadRoles = permissions.has('role.read');

    const rolesQuery = useQuery({ queryKey: ['tenant-roles', 'dingtalk-mapping'], queryFn: listTenantRoles, enabled: open && canReadRoles });
    const previewQuery = useQuery({
        queryKey: ['dingtalk-mapping-preview'],
        queryFn: () => previewDingTalkMapping({ createMissingDepartments: true, createMissingMembers: true }),
        enabled: open,
    });
    const roles = (rolesQuery.data?.items ?? []).filter((role) => role.code !== 'tenant_admin');
    const preview = previewQuery.data;
    const users = preview?.users ?? [];
    const createUsers = users.filter((user) => user.action === 'CREATE');
    const selectedUsers = selectedRoleId ? roleSelections[selectedRoleId] ?? [] : [];
    const selectedUserSet = useMemo(() => new Set(selectedUsers), [selectedUsers]);
    const assignedUserIds = useMemo(() => new Set(Object.values(roleSelections).flat()), [roleSelections]);
    const unassignedCreateCount = createUsers.filter((user) => !assignedUserIds.has(user.dingtalkUserId)).length;
    const hasConflicts = Boolean(preview && (preview.summary.departmentConflictCount > 0 || preview.summary.userConflictCount > 0));

    useEffect(() => {
        if (rolesQuery.error || previewQuery.error) {
            if (!hasStoredSession()) onSessionExpired();
        }
    }, [onSessionExpired, previewQuery.error, rolesQuery.error]);

    useEffect(() => {
        if (!open) return;
        setCredentials(undefined);
        setRoleSelections({});
        setSelectedRoleId(undefined);
    }, [open]);

    useEffect(() => {
        if (!selectedRoleId && roles[0]) setSelectedRoleId(roles[0].id);
    }, [roles, selectedRoleId]);

    const applyMutation = useMutation({
        mutationFn: () => applyDingTalkMapping({
            activationExpiresInDays: preview?.activationExpiresInDays ?? 7,
            createMissingDepartments: true,
            createMissingMembers: true,
            departmentResolutions: [],
            userResolutions: [],
            roleAssignments: Object.entries(roleSelections)
                .filter(([, dingtalkUserIds]) => dingtalkUserIds.length > 0)
                .map(([roleId, dingtalkUserIds]): DingTalkRoleAssignment => ({ roleId, dingtalkUserIds })),
        }),
        onSuccess: (result) => {
            setCredentials(result.credentials);
            onApplied();
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t('应用钉钉映射失败')),
    });

    const updateSelection = (userId: string, checked: boolean): void => {
        if (!selectedRoleId) return;
        setRoleSelections((current) => {
            const currentIds = new Set(current[selectedRoleId] ?? []);
            if (checked) currentIds.add(userId);
            else currentIds.delete(userId);
            return { ...current, [selectedRoleId]: [...currentIds] };
        });
    };

    const toggleAll = (checked: boolean): void => {
        if (!selectedRoleId) return;
        setRoleSelections((current) => ({ ...current, [selectedRoleId]: checked ? users.map((user) => user.dingtalkUserId) : [] }));
    };

    const exportCredentials = (): void => {
        if (!credentials?.length) return;
        const rows = credentials.map((credential) => ({
            '姓名': credential.displayName,
            '登录账号': credential.account,
            '租户编码': credential.tenantCode,
            '角色编码': credential.roleCodes.join('、'),
            '激活码': credential.activationToken,
            '过期时间': credential.activationExpiresAt.replace('T', ' ').slice(0, 19),
        }));
        const sheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, sheet, '激活凭证');
        XLSX.writeFile(workbook, `钉钉成员激活凭证-${authContext.tenant.code}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`);
    };

    const canApply = Boolean(preview && (createUsers.length === 0 || roles.length > 0) && unassignedCreateCount === 0 && !hasConflicts && !applyMutation.isPending);

    return <Modal
        open={open}
        width={1120}
        title={<span><TeamOutlined /> {t('钉钉组织映射与角色分配')}</span>}
        footer={credentials ? <><Button icon={<FileExcelOutlined />} type="primary" onClick={exportCredentials}>{t('导出激活凭证 Excel')}</Button><Button onClick={onClose}>{t('关闭')}</Button></> : <><Button onClick={onClose}>{t('取消')}</Button><Button icon={<CheckOutlined />} type="primary" loading={applyMutation.isPending} disabled={!canApply} onClick={() => applyMutation.mutate()}>{t('应用映射')}</Button></>}
        onCancel={onClose}
        destroyOnHidden
    >
        {credentials ? <>
            <Alert type="success" showIcon message={t('钉钉组织映射已完成')} description={t('已创建 {count} 名待激活成员。激活码只在本次响应中返回，请立即导出并安全分发。', { count: credentials.length })} />
            <Table size="small" rowKey="membershipId" pagination={false} dataSource={credentials} columns={[
                { title: t('姓名'), dataIndex: 'displayName' },
                { title: t('登录账号'), dataIndex: 'account' },
                { title: t('角色编码'), dataIndex: 'roleCodes', render: (codes: string[]) => codes.join('、') },
                { title: t('激活码'), dataIndex: 'activationToken', render: (token: string) => <code>{token}</code> },
            ]} />
        </> : <>
            {previewQuery.isLoading || rolesQuery.isLoading ? <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div> : previewQuery.error || rolesQuery.error ? <Alert type="error" showIcon message={t('加载钉钉映射数据失败')} action={<Button icon={<ReloadOutlined />} onClick={() => { void previewQuery.refetch(); void rolesQuery.refetch(); }}>{t('重试')}</Button>} /> : <>
                <Alert type="info" showIcon message={t('角色由租户管理员预先创建')} description={t('选择左侧角色后，在右侧勾选全部或部分人员。同一人员可以分配多个角色；tenant_admin 不允许通过钉钉映射分配。')} />
                {hasConflicts && <Alert type="warning" showIcon message={t('存在尚未处理的映射冲突')} description={t('请先处理部门或重名人员冲突，再应用映射。')} />}
                {roles.length === 0 ? <Empty description={t('当前租户没有可分配角色，请先创建角色')} /> : <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: 16, marginTop: 16 }}>
                    <div className="department-tree-panel" style={{ border: '1px solid var(--cees-border)', borderRadius: 8 }}>
                        <div className="department-tree-heading"><h3>{t('可分配角色')}</h3><small>{roles.length}</small></div>
                        <div className="role-list">{roles.map((role) => <button className={selectedRoleId === role.id ? 'is-active' : ''} type="button" key={role.id} onClick={() => setSelectedRoleId(role.id)}><span><strong>{role.name}</strong><small>{role.code}</small></span><Tag>{(roleSelections[role.id] ?? []).length}</Tag></button>)}</div>
                    </div>
                    <div>
                        <div className="panel-heading"><h3>{roles.find((role) => role.id === selectedRoleId)?.name ?? t('请选择角色')}</h3><small>{t('已选择 {count} 人', { count: selectedUsers.length })}</small></div>
                        <div style={{ marginBottom: 8 }}><Checkbox checked={users.length > 0 && selectedUserSet.size === users.length} indeterminate={selectedUserSet.size > 0 && selectedUserSet.size < users.length} onChange={(event) => toggleAll(event.target.checked)}>{t('全选当前人员')}</Checkbox></div>
                        <Table<DingTalkMappingUserPreview> size="small" rowKey="dingtalkUserId" pagination={{ pageSize: 10 }} dataSource={users} columns={[
                            { title: t('选择'), width: 70, render: (_, user) => <Checkbox checked={selectedUserSet.has(user.dingtalkUserId)} onChange={(event) => updateSelection(user.dingtalkUserId, event.target.checked)} /> },
                            { title: t('姓名'), dataIndex: 'name' },
                            { title: t('部门'), dataIndex: 'departmentPaths', render: (paths: string[]) => paths.join('、') || t('未分配部门') },
                            { title: t('映射动作'), dataIndex: 'action', render: (action: string) => <Tag color={action === 'CREATE' ? 'blue' : action === 'CONFLICT' ? 'orange' : 'green'}>{action}</Tag> },
                        ]} />
                    </div>
                </div>}
                {preview && <div style={{ marginTop: 12 }}><Tag color={unassignedCreateCount === 0 ? 'green' : 'orange'}>{unassignedCreateCount === 0 ? t('新成员角色已全部分配') : t('仍有 {count} 名新成员未分配角色', { count: unassignedCreateCount })}</Tag>{!hasConflicts && preview.summary.userCreateCount > 0 && <span style={{ marginLeft: 8, color: 'var(--cees-muted)' }}>{t('应用后会生成一次性激活凭证')}</span>}</div>}
            </>}
        </>}
    </Modal>;
}
