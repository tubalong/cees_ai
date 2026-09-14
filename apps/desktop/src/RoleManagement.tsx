import { DeleteOutlined, EditOutlined, LockOutlined, PlusOutlined, SafetyCertificateOutlined, SearchOutlined, TeamOutlined } from '@ant-design/icons';
import { Alert, App as AntdApp, Button, Checkbox, Empty, Form, Input, Modal, Select, Spin, Tag } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
    createTenantRole, deleteTenantRole, getTenantRole, hasStoredSession,
    listTenantPermissions, listTenantRoles, replaceTenantRolePermissions, updateTenantRole,
    type CreateRoleInput, type DataScope, type MeResult, type TenantPermission, type TenantRole,
} from './api';
import { useI18n } from './i18n';

interface RoleFormValues extends CreateRoleInput {
    permissionIds: string[];
}

/** 与后端 rbac.permission-catalog.DEFAULT_ROLE_PERMISSION_CODES 保持一致。 */
const DEFAULT_ROLE_PERMISSION_CODES = ['image.read', 'document.read', 'ai.image.generate', 'ai.document.generate'];

const dataScopeOptions: Array<{ label: string; value: DataScope }> = [
    { label: '仅本人', value: 'SELF' },
    { label: '本部门', value: 'DEPARTMENT' },
    { label: '本部门及下级', value: 'DEPARTMENT_TREE' },
    { label: '参与项目', value: 'PROJECT' },
    { label: '自定义范围', value: 'CUSTOM' },
    { label: '当前企业全部数据', value: 'TENANT' },
];

export default function RoleManagement({ authContext, onSessionExpired }: { authContext: MeResult; onSessionExpired: () => void }): JSX.Element {
    const [keyword, setKeyword] = useState('');
    const [selectedRoleId, setSelectedRoleId] = useState<string>();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingRole, setEditingRole] = useState<TenantRole>();
    const [form] = Form.useForm<RoleFormValues>();
    const { message, modal } = AntdApp.useApp();
    const { t } = useI18n();
    const queryClient = useQueryClient();
    const permissions = new Set(authContext.permissions);
    const rolesQuery = useQuery({ queryKey: ['tenant-roles'], queryFn: listTenantRoles, enabled: permissions.has('role.read') });
    const permissionsQuery = useQuery({ queryKey: ['tenant-permissions'], queryFn: listTenantPermissions, enabled: permissions.has('role.read') });
    const roles = rolesQuery.data?.items ?? [];
    const selectedId = selectedRoleId ?? roles[0]?.id;
    const roleQuery = useQuery({ queryKey: ['tenant-role', selectedId], queryFn: () => getTenantRole(selectedId!), enabled: Boolean(selectedId) && permissions.has('role.read') });
    const selectedRole = roleQuery.data ?? roles.find((role) => role.id === selectedId);
    const visibleRoles = roles.filter((role) => `${role.name}${role.code}${role.description ?? ''}`.toLowerCase().includes(keyword.toLowerCase()));

    useEffect(() => {
        if ((rolesQuery.error || permissionsQuery.error || roleQuery.error) && !hasStoredSession()) onSessionExpired();
    }, [onSessionExpired, permissionsQuery.error, roleQuery.error, rolesQuery.error]);

    const saveMutation = useMutation({
        mutationFn: async ({ values, role }: { values: RoleFormValues; role?: TenantRole }) => {
            const permissionIds = [...new Set(values.permissionIds ?? [])];
            if (permissionIds.length > 100) throw new Error(t('角色权限最多选择 100 项'));
            if (role) {
                let updated: TenantRole;
                try {
                    updated = await updateTenantRole(role.id, { name: values.name, description: values.description, dataScope: values.dataScope, version: role.version });
                } catch (error) {
                    throw new Error(t('角色资料更新失败：{message}', { message: errorMessage(error) }));
                }
                try {
                    return await replaceTenantRolePermissions(updated.id, permissionIds, updated.version);
                } catch (error) {
                    throw new Error(t('角色资料已更新，但权限配置失败：{message}', { message: errorMessage(error) }));
                }
            }
            let created: TenantRole;
            try {
                created = await createTenantRole(values);
            } catch (error) {
                throw new Error(t('角色创建失败：{message}', { message: errorMessage(error) }));
            }
            if (permissionIds.length === 0) return created;
            try {
                return await replaceTenantRolePermissions(created.id, permissionIds, created.version);
            } catch (error) {
                void queryClient.invalidateQueries({ queryKey: ['tenant-roles'] });
                throw new Error(t('角色已创建，但权限配置失败：{message}。请在角色列表中重新编辑权限', { message: errorMessage(error) }));
            }
        },
        onSuccess: (role) => {
            setDialogOpen(false);
            setEditingRole(undefined);
            form.resetFields();
            setSelectedRoleId(role.id);
            void queryClient.invalidateQueries({ queryKey: ['tenant-roles'] });
            void queryClient.invalidateQueries({ queryKey: ['tenant-role'] });
            message.success(t('角色与权限已保存，邀请同事时可立即选择'));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t('角色保存失败')),
    });
    const deleteMutation = useMutation({
        mutationFn: (role: TenantRole) => deleteTenantRole(role.id, role.version),
        onSuccess: (_, role) => {
            if (selectedRoleId === role.id) setSelectedRoleId(undefined);
            void queryClient.invalidateQueries({ queryKey: ['tenant-roles'] });
            message.success(t('角色已删除'));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t('角色仍被成员或资源授权使用，无法删除')),
    });

    const openCreate = (): void => {
        setEditingRole(undefined);
        form.resetFields();
        const defaultPermissionIds = (permissionsQuery.data?.items ?? [])
            .filter((permission) => DEFAULT_ROLE_PERMISSION_CODES.includes(permission.code))
            .map((permission) => permission.id);
        form.setFieldsValue({ dataScope: 'SELF', permissionIds: defaultPermissionIds });
        setDialogOpen(true);
    };
    const openEdit = (role: TenantRole): void => {
        setEditingRole(role);
        form.setFieldsValue({ code: role.code, name: role.name, description: role.description, dataScope: role.dataScope, permissionIds: role.permissions.map((permission) => permission.id) });
        setDialogOpen(true);
    };

    if (!permissions.has('role.read')) return <div className="workspace-page"><Alert type="warning" showIcon message={t('无权查看企业角色')} description={t('请联系企业管理员分配 role.read 权限。')} /></div>;

    return <div className="workspace-page role-management-page">
        <header className="workspace-page-header"><div><h1>{t('企业角色')}</h1><p>{t('为当前企业创建角色、设置数据范围和操作权限')}</p></div><Button type="primary" icon={<PlusOutlined />} disabled={!permissions.has('role.create')} onClick={openCreate}>{t('新建角色')}</Button></header>
        <div className="role-management-layout">
            <section className="role-list-panel">
                <Input prefix={<SearchOutlined />} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t('搜索角色')} />
                <div className="role-list">{rolesQuery.isLoading ? <div className="role-loading"><Spin /></div> : visibleRoles.length ? visibleRoles.map((role) => <button className={selectedId === role.id ? 'is-active' : ''} type="button" key={role.id} onClick={() => setSelectedRoleId(role.id)}><i>{role.isSystem ? <LockOutlined /> : <SafetyCertificateOutlined />}</i><span><strong>{role.name}</strong><small>{role.code} · {role.memberCount} {t('名成员')}</small></span>{role.isSystem && <Tag>{t('系统')}</Tag>}</button>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无角色')} />}</div>
            </section>
            <section className="role-detail-panel">
                {roleQuery.isLoading ? <div className="role-loading"><Spin /></div> : selectedRole ? <>
                    <div className="role-detail-heading"><div><i>{selectedRole.isSystem ? <LockOutlined /> : <SafetyCertificateOutlined />}</i><span><h2>{selectedRole.name}</h2><p>{selectedRole.description || t('暂无角色说明')}</p></span></div><div><Button icon={<EditOutlined />} disabled={selectedRole.isSystem || !permissions.has('role.update')} onClick={() => openEdit(selectedRole)}>{t('编辑')}</Button><Button danger icon={<DeleteOutlined />} disabled={selectedRole.isSystem || !permissions.has('role.delete')} onClick={() => modal.confirm({ title: `${t('删除角色')}“${selectedRole.name}”？`, content: t('只有未被成员和资源 ACL 使用的自定义角色可以删除。'), okText: t('删除'), okButtonProps: { danger: true }, cancelText: t('取消'), onOk: () => deleteMutation.mutateAsync(selectedRole) })}>{t('删除')}</Button></div></div>
                    {selectedRole.isSystem && <Alert type="info" showIcon message={t('tenant_admin 是系统角色')} description={t('系统角色由平台维护，企业管理员不能修改、替换权限或删除。')} />}
                    <div className="role-summary-grid"><div><TeamOutlined /><span>{t('成员数量')}<strong>{selectedRole.memberCount}</strong></span></div><div><SafetyCertificateOutlined /><span>{t('数据范围')}<strong>{t(dataScopeLabel(selectedRole.dataScope))}</strong></span></div><div><LockOutlined /><span>{t('权限数量')}<strong>{selectedRole.permissions.length}</strong></span></div></div>
                    <h3 className="role-permission-title">{t('已授予权限')}</h3>
                    <div className="permission-groups">{groupPermissions(selectedRole.permissions).map(([group, items]) => <section key={group}><h4>{t(groupLabel(group))}</h4>{items.map((permission) => <div key={permission.id}><span>{permission.name}</span><code>{permission.code}</code></div>)}</section>)}</div>
                </> : <Empty description={t('请选择角色')} />}
            </section>
        </div>
        <Modal title={editingRole ? t('编辑企业角色') : t('新建企业角色')} open={dialogOpen} onCancel={() => setDialogOpen(false)} onOk={() => form.submit()} confirmLoading={saveMutation.isPending} okText={t('保存角色')} cancelText={t('取消')} width={820} forceRender destroyOnHidden>
            <Form<RoleFormValues> form={form} layout="vertical" requiredMark={false} onFinish={(values) => saveMutation.mutate({ values, role: editingRole })}>
                <div className="role-form-grid"><Form.Item name="code" label={t('角色编码')} rules={[{ required: true, message: t('请输入角色编码') }, { min: 2, max: 64 }, { pattern: /^[a-z][a-z0-9_:-]*$/, message: t('请使用小写字母开头，可包含数字、_、:、-') }]}><Input disabled={Boolean(editingRole)} placeholder="sales_manager" /></Form.Item><Form.Item name="name" label={t('角色名称')} rules={[{ required: true, message: t('请输入角色名称') }, { max: 120 }]}><Input placeholder={t('例如：销售经理')} /></Form.Item></div>
                <Form.Item name="description" label={t('角色说明')}><Input.TextArea rows={2} maxLength={500} showCount /></Form.Item>
                <Form.Item name="dataScope" label={t('数据范围')} rules={[{ required: true, message: t('请选择数据范围') }]}><Select options={dataScopeOptions.map((option) => ({ ...option, label: t(option.label) }))} /></Form.Item>
                <Form.Item name="permissionIds" initialValue={[]} label={`${t('操作权限')}（${permissionsQuery.data?.items.length ?? 0}）`} rules={[{ type: 'array', max: 100, message: t('角色权限最多选择 100 项') }]}><Checkbox.Group className="role-permission-checkboxes" options={(permissionsQuery.data?.items ?? []).map((permission) => ({ label: <span>{permission.name}<small>{permission.code}</small></span>, value: permission.id }))} /></Form.Item>
            </Form>
        </Modal>
    </div>;
}

function groupPermissions(permissions: TenantPermission[]): Array<[string, TenantPermission[]]> {
    const groups = new Map<string, TenantPermission[]>();
    for (const permission of permissions) {
        const group = permission.code.split('.')[0];
        groups.set(group, [...(groups.get(group) ?? []), permission]);
    }
    return [...groups.entries()];
}

function groupLabel(group: string): string {
    return { tenant: '企业', department: '部门', member: '成员', role: '角色', project: '项目', document: '文档', audit: '审计' }[group] ?? group;
}

function dataScopeLabel(scope: DataScope): string {
    return dataScopeOptions.find((option) => option.value === scope)?.label ?? scope;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '请求参数或状态不合法';
}