import {
    BankOutlined, DeleteOutlined, EditOutlined, FolderOutlined, PlusOutlined,
    ReloadOutlined, TeamOutlined, UploadOutlined, UserAddOutlined,
} from '@ant-design/icons';
import { App as AntdApp, Avatar, Button, Empty, Form, Input, Modal, Select, Spin, Tag } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
    assignMemberDepartment, createDepartment, deleteDepartment, hasStoredSession,
    listDepartmentMembers, listDepartments, updateDepartment,
    type DepartmentNode, type MeResult, type TenantMember,
} from '../../core/api';
import InvitationManager from './InvitationManager';
import OrganizationImportModal from './OrganizationImportModal';
import { useDateFormatter, useI18n } from '../../core/i18n';

interface DepartmentFormValues {
    name: string;
    parentId?: string;
    status?: 'ACTIVE' | 'DISABLED';
}

interface DepartmentDialogState {
    department?: DepartmentNode;
    parentId?: string;
}

export default function OrganizationManagement({ authContext, fallbackMembers, membersLoading, onSessionExpired }: { authContext: MeResult; fallbackMembers: TenantMember[]; membersLoading: boolean; onSessionExpired: () => void }): JSX.Element {
    const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>();
    const [selectedMemberId, setSelectedMemberId] = useState<string>();
    const [keyword, setKeyword] = useState('');
    const [invitationsOpen, setInvitationsOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [dialog, setDialog] = useState<DepartmentDialogState>();
    const [form] = Form.useForm<DepartmentFormValues>();
    const { message, modal } = AntdApp.useApp();
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    const queryClient = useQueryClient();
    const permissions = new Set(authContext.permissions);
    const canReadDepartments = permissions.has('department.read');
    const canImportOrganization = permissions.has('department.create') && permissions.has('member.invite') && permissions.has('role.assign');

    const departmentsQuery = useQuery({ queryKey: ['departments'], queryFn: () => listDepartments(), enabled: canReadDepartments });
    const departmentMembersQuery = useQuery({
        queryKey: ['department-members', selectedDepartmentId],
        queryFn: () => listDepartmentMembers(selectedDepartmentId!),
        enabled: Boolean(selectedDepartmentId) && canReadDepartments && permissions.has('member.read'),
    });
    const departmentRoots = departmentsQuery.data?.items ?? [];
    const flatDepartments = flattenDepartments(departmentRoots);
    const sourceMembers = selectedDepartmentId ? departmentMembersQuery.data?.items ?? [] : fallbackMembers;
    const visibleMembers = sourceMembers.filter((member) => `${member.user.displayName}${member.account}${member.roles.map((role) => role.name).join('')}`.toLowerCase().includes(keyword.toLowerCase()));
    const selectedMember = sourceMembers.find((member) => member.id === selectedMemberId) ?? sourceMembers[0];
    const selectedDepartment = flatDepartments.find((department) => department.id === selectedDepartmentId);

    useEffect(() => {
        if ((departmentsQuery.error || departmentMembersQuery.error) && !hasStoredSession()) onSessionExpired();
    }, [departmentMembersQuery.error, departmentsQuery.error, onSessionExpired]);

    const saveMutation = useMutation({
        mutationFn: async ({ state, values }: { state: DepartmentDialogState; values: DepartmentFormValues }) => {
            if (state.department) {
                return updateDepartment(state.department.id, {
                    name: values.name,
                    parentId: values.parentId === 'ROOT' ? null : values.parentId,
                    status: values.status,
                    version: state.department.version,
                });
            }
            return createDepartment({ name: values.name, parentId: state.parentId ?? (values.parentId === 'ROOT' ? undefined : values.parentId) });
        },
        onSuccess: () => {
            setDialog(undefined);
            form.resetFields();
            void queryClient.invalidateQueries({ queryKey: ['departments'] });
            message.success(t('部门信息已保存'));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t('部门保存失败')),
    });
    const deleteMutation = useMutation({
        mutationFn: (department: DepartmentNode) => deleteDepartment(department.id, department.version),
        onSuccess: (_, department) => {
            if (selectedDepartmentId === department.id) setSelectedDepartmentId(undefined);
            void queryClient.invalidateQueries({ queryKey: ['departments'] });
            message.success(t('部门已删除'));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t('仅空部门可以删除')),
    });
    const assignMutation = useMutation({
        mutationFn: ({ member, departmentId }: { member: TenantMember; departmentId: string }) => assignMemberDepartment(member.id, { departmentId, version: member.version }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['tenant-members'] });
            void queryClient.invalidateQueries({ queryKey: ['department-members'] });
            void queryClient.invalidateQueries({ queryKey: ['departments'] });
            message.success(t('成员所属部门已调整'));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t('成员调岗失败')),
    });

    const openCreate = (parentId?: string): void => {
        form.resetFields();
        form.setFieldsValue({ parentId: parentId ?? 'ROOT', status: 'ACTIVE' });
        setDialog({ parentId });
    };
    const openEdit = (department: DepartmentNode): void => {
        form.setFieldsValue({ name: department.name, parentId: department.parentId ?? 'ROOT', status: department.status });
        setDialog({ department });
    };

    return <div className="workspace-page architecture-page">
        <header className="workspace-page-header"><div><h1>{t('组织与部门')}</h1><p>{t('企业管理员维护当前企业的部门、成员归属和同事邀请')}</p></div><div className="header-actions"><Button icon={<ReloadOutlined />} onClick={() => void departmentsQuery.refetch()}>{t('刷新')}</Button><Button icon={<UserAddOutlined />} disabled={!permissions.has('member.invite')} onClick={() => setInvitationsOpen(true)}>{t('邀请同事')}</Button>{canImportOrganization && <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>{t('批量导入')}</Button>}<Button type="primary" icon={<PlusOutlined />} disabled={!permissions.has('department.create')} onClick={() => openCreate()}>{t('新建部门')}</Button></div></header>
        <div className="architecture-layout">
            <aside className="organization-tree department-tree-panel surface-panel">
                <div className="department-tree-heading"><h3>{t('组织架构')}</h3><Tag>{t('{count} 个部门', { count: flatDepartments.length })}</Tag></div>
                <button className={`department-root ${!selectedDepartmentId ? 'is-active' : ''}`} type="button" onClick={() => setSelectedDepartmentId(undefined)}><BankOutlined /><span>{authContext.tenant.name}<small>{t('全部成员')}</small></span></button>
                {departmentsQuery.isLoading ? <div className="data-loading"><Spin /></div> : departmentRoots.length ? <div className="department-nodes">{departmentRoots.map((department) => <DepartmentTreeNode key={department.id} department={department} selectedId={selectedDepartmentId} permissions={permissions} onSelect={setSelectedDepartmentId} onCreate={openCreate} onEdit={openEdit} onDelete={(target) => modal.confirm({ title: t('删除部门“{name}”？', { name: target.name }), content: t('只有没有子部门且没有成员的部门可以删除。'), okText: t('删除'), okButtonProps: { danger: true }, cancelText: t('取消'), onOk: () => deleteMutation.mutateAsync(target) })} />)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('尚未创建部门')} />}
            </aside>
            <section className="member-list surface-panel"><div className="member-list-toolbar"><Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t('搜索成员姓名、账号、角色')} /><span>{selectedDepartment?.name ?? t('全部成员')}</span></div><div className="member-table"><div className="member-table-head"><span>{t('姓名')}</span><span>{t('账号')}</span><span>{t('状态')}</span><span>{t('角色')}</span></div>{membersLoading || departmentMembersQuery.isLoading ? <div className="data-loading"><Spin /></div> : visibleMembers.length ? visibleMembers.map((member) => <button className={selectedMember?.id === member.id ? 'is-selected' : ''} type="button" key={member.id} onClick={() => setSelectedMemberId(member.id)}><span><Avatar size={30}>{member.user.displayName.slice(-1)}</Avatar>{member.user.displayName}</span><span>{member.account}</span><span>{member.status === 'ACTIVE' ? t('正常') : member.status}</span><span>{member.roles.map((role) => role.name).join('、') || t('未分配')}</span></button>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('该范围暂无成员')} />}</div><footer>{t('共 {count} 名成员', { count: visibleMembers.length })}</footer></section>
            <aside className="member-detail surface-panel">{selectedMember ? <><Avatar size={58}>{selectedMember.user.displayName.slice(-1)}</Avatar><h2>{selectedMember.user.displayName}</h2><p>{t('账号：{account}', { account: selectedMember.account })}</p><small>{t(departmentName(selectedMember.departmentId, flatDepartments))}</small><div className="detail-section"><h3>{t('所属部门')}</h3><Select value={selectedMember.departmentId ?? undefined} placeholder={t('未分配部门')} disabled={!permissions.has('department.member.assign')} loading={assignMutation.isPending} options={flatDepartments.filter((department) => department.status === 'ACTIVE').map((department) => ({ label: department.path, value: department.id }))} onChange={(departmentId) => assignMutation.mutate({ member: selectedMember, departmentId })} /></div><div className="detail-section"><span>{t('角色')} <Tag color="blue">{selectedMember.roles.map((role) => role.name).join('、') || t('未分配')}</Tag></span></div><div className="member-meta"><span>{t('账号状态')} <b>{selectedMember.status === 'ACTIVE' ? t('在职') : selectedMember.status}</b></span><span>{t('加入时间')} <b>{formatDate(selectedMember.joinedAt)}</b></span></div></> : <Empty description={t('请选择成员')} />}</aside>
        </div>
        <Modal title={dialog?.department ? t('编辑部门') : dialog?.parentId ? t('新建子部门') : t('新建部门')} open={Boolean(dialog)} onCancel={() => setDialog(undefined)} onOk={() => form.submit()} confirmLoading={saveMutation.isPending} okText={t('保存')} cancelText={t('取消')} destroyOnHidden forceRender>
            <Form<DepartmentFormValues> form={form} layout="vertical" requiredMark={false} onFinish={(values) => dialog && saveMutation.mutate({ state: dialog, values })}>
                <Form.Item name="name" label={t('部门名称')} rules={[{ required: true, message: t('请输入部门名称') }, { max: 120 }]}><Input placeholder={t('例如：产品研发部')} /></Form.Item>
                {!dialog?.parentId && <Form.Item name="parentId" label={t('上级部门')}><Select options={[{ label: t('企业根节点'), value: 'ROOT' }, ...flatDepartments.filter((department) => department.id !== dialog?.department?.id).map((department) => ({ label: department.path, value: department.id }))]} /></Form.Item>}
                {dialog?.department && <Form.Item name="status" label={t('部门状态')}><Select options={[{ label: t('启用'), value: 'ACTIVE' }, { label: t('停用'), value: 'DISABLED' }]} /></Form.Item>}
            </Form>
        </Modal>
        <InvitationManager open={invitationsOpen} tenantCode={authContext.tenant.code} onClose={() => setInvitationsOpen(false)} />
        <OrganizationImportModal open={importOpen} tenantCode={authContext.tenant.code} onClose={() => setImportOpen(false)} onImported={() => {
            void queryClient.invalidateQueries({ queryKey: ['departments'] });
            void queryClient.invalidateQueries({ queryKey: ['tenant-members'] });
        }} />
    </div>;
}

function DepartmentTreeNode({ department, selectedId, permissions, onSelect, onCreate, onEdit, onDelete }: { department: DepartmentNode; selectedId?: string; permissions: Set<string>; onSelect: (id: string) => void; onCreate: (parentId: string) => void; onEdit: (department: DepartmentNode) => void; onDelete: (department: DepartmentNode) => void }): JSX.Element {
    const { t } = useI18n();
    return <div className="department-tree-node"><div className={`department-node-row ${selectedId === department.id ? 'is-active' : ''}`}><button type="button" onClick={() => onSelect(department.id)}><FolderOutlined /><span>{department.name}<small>{t('{count} 人', { count: department.memberCount ?? 0 })} · {department.status === 'ACTIVE' ? t('启用') : t('停用')}</small></span></button><span className="department-node-actions"><Button type="text" size="small" icon={<PlusOutlined />} disabled={!permissions.has('department.create')} onClick={() => onCreate(department.id)} /><Button type="text" size="small" icon={<EditOutlined />} disabled={!permissions.has('department.update')} onClick={() => onEdit(department)} /><Button type="text" size="small" danger icon={<DeleteOutlined />} disabled={!permissions.has('department.delete')} onClick={() => onDelete(department)} /></span></div>{(department.children ?? []).length > 0 && <div className="department-children">{(department.children ?? []).map((child) => <DepartmentTreeNode key={child.id} department={child} selectedId={selectedId} permissions={permissions} onSelect={onSelect} onCreate={onCreate} onEdit={onEdit} onDelete={onDelete} />)}</div>}</div>;
}

function flattenDepartments(departments: DepartmentNode[], parentPath = ''): Array<DepartmentNode & { path: string }> {
    return departments.flatMap((department) => {
        const path = parentPath ? `${parentPath} / ${department.name}` : department.name;
        return [{ ...department, path }, ...flattenDepartments(department.children ?? [], path)];
    });
}

function departmentName(departmentId: string | null, departments: Array<DepartmentNode & { path: string }>): string {
    if (!departmentId) return '未分配部门';
    return departments.find((department) => department.id === departmentId)?.path ?? '未知部门';
}
