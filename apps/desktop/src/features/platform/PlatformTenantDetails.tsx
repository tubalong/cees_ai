import { DeleteOutlined, EditOutlined, PauseCircleOutlined, PlusOutlined, ReloadOutlined, SafetyCertificateOutlined, TeamOutlined } from '@ant-design/icons';
import { Alert, App as AntdApp, Button, Drawer, Empty, Form, Input, Modal, Spin, Tag } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
    assignPlatformTenantAdministrator, getPlatformTenant, hasStoredPlatformSession,
    listPlatformTenantAdministrators, removePlatformTenantAdministrator,
    restorePlatformTenant, suspendPlatformTenant, updatePlatformTenant,
    type AssignPlatformTenantAdministratorInput, type PlatformTenant,
} from '../../core/api';
import { useDateFormatter, useI18n } from '../../core/i18n';

interface TenantNameForm { name: string }
interface SuspendForm { reason: string }
interface InvitationCredential { tenantCode: string; account: string; invitationToken: string }

export default function PlatformTenantDetails({ tenantId, permissions, onClose, onSessionExpired }: { tenantId?: string; permissions: string[]; onClose: () => void; onSessionExpired: () => void }): JSX.Element {
    const [editOpen, setEditOpen] = useState(false);
    const [suspendOpen, setSuspendOpen] = useState(false);
    const [assignOpen, setAssignOpen] = useState(false);
    const [credential, setCredential] = useState<InvitationCredential>();
    const [nameForm] = Form.useForm<TenantNameForm>();
    const [suspendForm] = Form.useForm<SuspendForm>();
    const [assignForm] = Form.useForm<AssignPlatformTenantAdministratorInput>();
    const { message, modal } = AntdApp.useApp();
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    const queryClient = useQueryClient();
    const permissionSet = new Set(permissions);
    const tenantQuery = useQuery({ queryKey: ['platform-tenant', tenantId], queryFn: () => getPlatformTenant(tenantId!), enabled: Boolean(tenantId) });
    const administratorsQuery = useQuery({ queryKey: ['platform-tenant-administrators', tenantId], queryFn: () => listPlatformTenantAdministrators(tenantId!), enabled: Boolean(tenantId) && permissionSet.has('platform.tenant.admin.read') });
    const tenant = tenantQuery.data;

    useEffect(() => {
        if ((tenantQuery.error || administratorsQuery.error) && !hasStoredPlatformSession()) onSessionExpired();
    }, [administratorsQuery.error, onSessionExpired, tenantQuery.error]);

    const refreshTenant = (): void => {
        void queryClient.invalidateQueries({ queryKey: ['platform-tenants'] });
        void queryClient.invalidateQueries({ queryKey: ['platform-tenant', tenantId] });
    };
    const updateMutation = useMutation({
        mutationFn: ({ name }: TenantNameForm) => updatePlatformTenant(tenantId!, name, tenant!.version),
        onSuccess: () => { setEditOpen(false); refreshTenant(); message.success(t('租户名称已更新')); },
        onError: showError(() => t('租户更新失败')),
    });
    const suspendMutation = useMutation({
        mutationFn: ({ reason }: SuspendForm) => suspendPlatformTenant(tenantId!, reason, tenant!.version),
        onSuccess: () => { setSuspendOpen(false); suspendForm.resetFields(); refreshTenant(); message.success(t('租户已停用，租户会话已撤销')); },
        onError: showError(() => t('租户停用失败')),
    });
    const restoreMutation = useMutation({
        mutationFn: () => restorePlatformTenant(tenantId!, tenant!.version),
        onSuccess: () => { refreshTenant(); message.success(t('租户已恢复，成员需要重新登录')); },
        onError: showError(() => t('租户恢复失败')),
    });
    const assignMutation = useMutation({
        mutationFn: (input: AssignPlatformTenantAdministratorInput) => assignPlatformTenantAdministrator(tenantId!, input),
        onSuccess: (result, variables) => {
            const invitationToken = findStringByKey(result, 'invitationToken');
            if (invitationToken) setCredential({ tenantCode: tenant!.code, account: findStringByKey(result, 'account') ?? variables.account, invitationToken });
            else message.success(t('现有成员已设为租户管理员'));
            setAssignOpen(false);
            assignForm.resetFields();
            void queryClient.invalidateQueries({ queryKey: ['platform-tenant-administrators', tenantId] });
            refreshTenant();
        },
        onError: showError(() => t('管理员分配失败')),
    });
    const removeMutation = useMutation({
        mutationFn: (membershipId: string) => removePlatformTenantAdministrator(tenantId!, membershipId),
        onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['platform-tenant-administrators', tenantId] }); refreshTenant(); message.success(t('已取消租户管理员角色')); },
        onError: showError(() => t('取消管理员失败')),
    });

    function showError(fallback: () => string): (error: Error) => void {
        return (error) => message.error(error.message || fallback());
    }

    const openEdit = (): void => {
        if (!tenant) return;
        nameForm.setFieldsValue({ name: tenant.name });
        setEditOpen(true);
    };

    return <>
        <Drawer title={t('租户详情与管理员')} width={600} open={Boolean(tenantId)} onClose={onClose} destroyOnHidden extra={<Button icon={<ReloadOutlined />} onClick={() => { void tenantQuery.refetch(); void administratorsQuery.refetch(); }}>{t('刷新')}</Button>}>
            {tenantQuery.isLoading ? <div className="platform-drawer-loading"><Spin /></div> : tenant ? <div className="platform-tenant-details">
                <section className="tenant-detail-summary"><div><i><TeamOutlined /></i><span><h2>{tenant.name}</h2><p>{tenant.code}</p></span></div><Tag color={statusColor(tenant.status)}>{t(statusLabel(tenant.status))}</Tag></section>
                <div className="tenant-detail-actions">
                    <Button icon={<EditOutlined />} disabled={!permissionSet.has('platform.tenant.update')} onClick={openEdit}>{t('修改名称')}</Button>
                    {tenant.status === 'ACTIVE' ? <Button danger icon={<PauseCircleOutlined />} disabled={!permissionSet.has('platform.tenant.suspend')} onClick={() => setSuspendOpen(true)}>{t('停用租户')}</Button> : tenant.status === 'SUSPENDED' ? <Button type="primary" icon={<ReloadOutlined />} disabled={!permissionSet.has('platform.tenant.restore')} loading={restoreMutation.isPending} onClick={() => modal.confirm({ title: t('恢复该租户？'), content: t('恢复后旧 Session 不会恢复，成员需要重新登录。'), okText: t('恢复租户'), cancelText: t('取消'), onOk: () => restoreMutation.mutateAsync() })}>{t('恢复租户')}</Button> : null}
                </div>
                <dl className="tenant-detail-meta"><div><dt>{t('当前版本')}</dt><dd>v{tenant.version}</dd></div><div><dt>{t('有效管理员')}</dt><dd>{tenant.activeAdministratorCount}</dd></div><div><dt>{t('待激活邀请')}</dt><dd>{tenant.pendingInvitationCount}</dd></div><div><dt>{t('创建时间')}</dt><dd>{formatDate(tenant.createdAt)}</dd></div></dl>
                <section className="tenant-admin-section">
                    <div className="tenant-admin-heading"><div><h3>{t('租户管理员')}</h3><p>{t('分配现有成员，或为新账号创建管理员邀请')}</p></div><Button type="primary" icon={<PlusOutlined />} disabled={!permissionSet.has('platform.tenant.admin.assign')} onClick={() => setAssignOpen(true)}>{t('添加管理员')}</Button></div>
                    <Alert type="info" showIcon message={t('平台接口不直接修改管理员登录账号')} description={t('管理员账号变更由该企业内具备 member.account.update 权限的企业管理员处理，修改后会撤销目标成员旧会话。')} />
                    <div className="tenant-admin-list">{administratorsQuery.isLoading ? <div className="platform-drawer-loading"><Spin /></div> : administratorsQuery.data?.items.length ? administratorsQuery.data.items.map((administrator) => {
                        const membershipId = administrator.membershipId ?? administrator.id;
                        const displayName = administrator.displayName ?? administrator.user?.displayName ?? administrator.account;
                        return <div className="tenant-admin-row" key={membershipId ?? administrator.account}><span><SafetyCertificateOutlined /><b>{displayName}</b><small>{administrator.account}</small></span><Tag color="green">{t('租户管理员')}</Tag><Button type="text" danger icon={<DeleteOutlined />} disabled={!membershipId || !permissionSet.has('platform.tenant.admin.remove')} onClick={() => membershipId && modal.confirm({ title: t('取消“{name}”的管理员角色？', { name: displayName }), content: t('该成员仍保留普通租户成员身份。'), okText: t('取消管理员'), okButtonProps: { danger: true }, cancelText: t('返回'), onOk: () => removeMutation.mutateAsync(membershipId) })} /></div>;
                    }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无已激活管理员')} />}</div>
                </section>
            </div> : <Empty description={t('无法加载租户详情')} />}
        </Drawer>
        <Modal title={t('修改租户名称')} open={editOpen} onCancel={() => setEditOpen(false)} onOk={() => nameForm.submit()} confirmLoading={updateMutation.isPending} okText={t('保存')} cancelText={t('取消')} forceRender destroyOnHidden><Form<TenantNameForm> form={nameForm} layout="vertical" requiredMark={false} onFinish={(values) => updateMutation.mutate(values)}><Form.Item name="name" label={t('租户名称')} rules={[{ required: true, message: t('请输入租户名称') }, { max: 120 }]}><Input /></Form.Item></Form></Modal>
        <Modal title={t('停用租户')} open={suspendOpen} onCancel={() => setSuspendOpen(false)} onOk={() => suspendForm.submit()} confirmLoading={suspendMutation.isPending} okText={t('确认停用')} okButtonProps={{ danger: true }} cancelText={t('取消')} forceRender destroyOnHidden><Form<SuspendForm> form={suspendForm} layout="vertical" requiredMark={false} onFinish={(values) => suspendMutation.mutate(values)}><Alert type="warning" showIcon message={t('停用会撤销该租户全部未撤销 Session')} description={t('恢复后所有成员仍需重新登录。')} /><Form.Item name="reason" label={t('停用原因')} rules={[{ required: true, message: t('请输入停用原因') }, { max: 500 }]}><Input.TextArea rows={4} /></Form.Item></Form></Modal>
        <Modal title={t('添加租户管理员')} open={assignOpen} onCancel={() => setAssignOpen(false)} onOk={() => assignForm.submit()} confirmLoading={assignMutation.isPending} okText={t('确认添加')} cancelText={t('取消')} forceRender destroyOnHidden><Form<AssignPlatformTenantAdministratorInput> form={assignForm} layout="vertical" requiredMark={false} onFinish={(values) => assignMutation.mutate(values)}><Form.Item name="account" label={t('成员账号')} rules={[{ required: true, message: t('请输入成员账号') }, { min: 3, max: 32 }, { pattern: /^[a-zA-Z0-9]+$/, message: t('账号仅支持英文字母和数字') }]}><Input placeholder={t('已有成员账号或待邀请的新账号')} /></Form.Item><Form.Item name="displayName" label={t('显示名称（新账号时使用）')} rules={[{ max: 120 }]}><Input placeholder={t('已有成员可留空')} /></Form.Item><Alert type="info" showIcon message={t('已有账号将直接获得管理员角色')} description={t('账号不存在时，服务端会创建管理员邀请并返回一次性激活令牌。')} /></Form></Modal>
        <Modal title={t('租户管理员激活凭证')} open={Boolean(credential)} closable={false} maskClosable={false} footer={<Button type="primary" onClick={() => setCredential(undefined)}>{t('我已安全保存')}</Button>}><div className="one-time-credential">{credential && <><Alert type="warning" showIcon message={t('令牌只显示一次')} description={t('请立即通过安全渠道交付给管理员。')} /><dl><div><dt>{t('企业标识')}</dt><dd>{credential.tenantCode}</dd></div><div><dt>{t('管理员账号')}</dt><dd>{credential.account}</dd></div><div><dt>{t('激活令牌')}</dt><dd>{credential.invitationToken}</dd></div></dl><Button block onClick={() => void navigator.clipboard.writeText(t('激活凭证文本', { tenantCode: credential.tenantCode, account: credential.account, token: credential.invitationToken })).then(() => message.success(t('激活凭证已复制')))}>{t('复制全部凭证')}</Button></>}</div></Modal>
    </>;
}

function findStringByKey(value: unknown, targetKey: string): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    for (const [key, child] of Object.entries(value)) {
        if (key === targetKey && typeof child === 'string') return child;
        const nested = findStringByKey(child, targetKey);
        if (nested) return nested;
    }
    return undefined;
}

function statusColor(status: PlatformTenant['status']): string { return status === 'ACTIVE' ? 'green' : status === 'SUSPENDED' ? 'red' : 'orange'; }
function statusLabel(status: PlatformTenant['status']): string { return { ACTIVE: '正常', SUSPENDED: '已停用', PENDING_ACTIVATION: '待激活' }[status]; }