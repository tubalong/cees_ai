import { BankOutlined, LogoutOutlined, PlusOutlined, SafetyCertificateOutlined, SearchOutlined, TeamOutlined } from '@ant-design/icons';
import { Alert, App as AntdApp, Button, Empty, Form, Input, Modal, Spin, Tag } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createPlatformTenant, listPlatformTenants, platformLogout, type CreatePlatformTenantInput, type PlatformMeResult } from '../../core/api';
import PlatformTenantDetails from './PlatformTenantDetails';
import { useDateFormatter, useI18n } from '../../core/i18n';

interface OneTimeCredential {
    tenantCode: string;
    account: string;
    invitationToken: string;
}

export default function PlatformWorkspace({ context, onSessionExpired }: { context: PlatformMeResult; onSessionExpired: () => void }): JSX.Element {
    const [keyword, setKeyword] = useState('');
    const [createOpen, setCreateOpen] = useState(false);
    const [selectedTenantId, setSelectedTenantId] = useState<string>();
    const [credential, setCredential] = useState<OneTimeCredential>();
    const [createForm] = Form.useForm<CreatePlatformTenantInput>();
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    const queryClient = useQueryClient();
    const tenantsQuery = useQuery({ queryKey: ['platform-tenants'], queryFn: listPlatformTenants });
    const tenants = (tenantsQuery.data?.items ?? []).filter((tenant) => `${tenant.name}${tenant.code}`.toLowerCase().includes(keyword.toLowerCase()));
    const canCreateTenant = context.administrator.permissions.includes('platform.tenant.create');
    const createMutation = useMutation({
        mutationFn: createPlatformTenant,
        onSuccess: (result, variables) => {
            const invitationToken = findStringByKey(result, 'invitationToken');
            if (invitationToken) {
                setCredential({
                    tenantCode: variables.code.trim().toLowerCase(),
                    account: findStringByKey(result, 'account') ?? variables.initialAdministrator.account ?? t('由系统生成'),
                    invitationToken,
                });
            } else {
                message.warning(t('租户已创建，但响应中未找到一次性激活令牌，请联系后端确认响应结构'));
            }
            setCreateOpen(false);
            createForm.resetFields();
            void queryClient.invalidateQueries({ queryKey: ['platform-tenants'] });
            message.success(t('租户创建成功'));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t('租户创建失败')),
    });

    const handleLogout = async (): Promise<void> => {
        await platformLogout();
        message.success(t('已退出超级管理员账号'));
        onSessionExpired();
    };

    return <main className="platform-workspace">
        <header className="platform-topbar">
            <div className="platform-brand"><span>B</span><div><strong>{t('CEES AI 平台管理')}</strong><small>{t('超级管理员控制台')}</small></div></div>
            <div className="platform-account"><SafetyCertificateOutlined /><span><strong>{context.administrator.user.displayName}</strong><small>{context.administrator.account} · SUPER_ADMIN</small></span><Button type="text" icon={<LogoutOutlined />} onClick={() => void handleLogout()}>{t('退出')}</Button></div>
        </header>
        <section className="platform-content">
            <div className="platform-heading"><div><h1>{t('租户管理')}</h1><p>{t('查看和管理 CEES AI 平台中的企业租户')}</p></div><Button type="primary" icon={<PlusOutlined />} disabled={!canCreateTenant} onClick={() => setCreateOpen(true)}>{t('创建租户')}</Button></div>
            <div className="platform-metrics">
                <div><i><BankOutlined /></i><span>{t('租户总数')}<strong>{tenantsQuery.data?.items.length ?? 0}</strong></span></div>
                <div><i><SafetyCertificateOutlined /></i><span>{t('正常租户')}<strong>{tenantsQuery.data?.items.filter((tenant) => tenant.status === 'ACTIVE').length ?? 0}</strong></span></div>
                <div><i><TeamOutlined /></i><span>{t('租户管理员')}<strong>{tenantsQuery.data?.items.reduce((sum, tenant) => sum + tenant.activeAdministratorCount, 0) ?? 0}</strong></span></div>
            </div>
            <section className="platform-tenant-panel">
                <div className="platform-toolbar"><Input value={keyword} onChange={(event) => setKeyword(event.target.value)} prefix={<SearchOutlined />} placeholder={t('搜索租户名称或企业标识')} /></div>
                <div className="platform-table-head"><span>{t('租户')}</span><span>{t('状态')}</span><span>{t('管理员')}</span><span>{t('待激活邀请')}</span><span>{t('创建时间')}</span></div>
                {tenantsQuery.isLoading ? <div className="platform-loading"><Spin /></div> : tenants.length ? tenants.map((tenant) => <button type="button" className="platform-tenant-row" key={tenant.id} onClick={() => setSelectedTenantId(tenant.id)}><span><i><BankOutlined /></i><b>{tenant.name}</b><small>{tenant.code}</small></span><span><Tag color={tenant.status === 'ACTIVE' ? 'green' : tenant.status === 'SUSPENDED' ? 'red' : 'orange'}>{tenant.status}</Tag></span><span>{tenant.activeAdministratorCount}</span><span>{tenant.pendingInvitationCount}</span><span>{formatDate(tenant.createdAt)}</span></button>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无租户')} />}
            </section>
        </section>
        <Modal title={t('创建企业租户')} open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => createForm.submit()} confirmLoading={createMutation.isPending} okText={t('创建租户')} cancelText={t('取消')} destroyOnHidden>
            <Form<CreatePlatformTenantInput> form={createForm} layout="vertical" onFinish={(values) => createMutation.mutate(values)} requiredMark={false} preserve={false}>
                <Form.Item name="code" label={t('企业标识')} rules={[{ required: true, message: t('请输入企业标识') }, { min: 2, max: 64 }, { pattern: /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, message: t('仅支持字母、数字、下划线和连字符') }]}><Input placeholder="acme" /></Form.Item>
                <Form.Item name="name" label={t('企业名称')} rules={[{ required: true, message: t('请输入企业名称') }, { max: 120 }]}><Input /></Form.Item>
                <Form.Item name={['initialAdministrator', 'displayName']} label={t('首位管理员姓名')} rules={[{ required: true, message: t('请输入管理员姓名') }, { max: 120 }]}><Input /></Form.Item>
                <Form.Item name={['initialAdministrator', 'account']} label={t('管理员账号（可选）')} rules={[{ min: 3, max: 32 }, { pattern: /^[a-zA-Z0-9]*$/, message: t('账号仅支持英文字母和数字') }]} extra={t('不填写时由服务端根据管理员姓名生成')}><Input placeholder="zhangsan" /></Form.Item>
                <Alert type="info" showIcon message={t('创建后租户处于待激活状态')} description={t('系统将返回一次性激活令牌，请立即通过受控渠道交付给首位管理员。')} />
            </Form>
        </Modal>
        <Modal title={t('首位管理员激活凭证')} open={Boolean(credential)} onCancel={() => setCredential(undefined)} footer={<Button type="primary" onClick={() => setCredential(undefined)}>{t('我已安全保存')}</Button>} closable={false} maskClosable={false}>
            {credential && <div className="one-time-credential">
                <Alert type="warning" showIcon message={t('该令牌只在本次响应中返回一次')} description={t('关闭前请完成复制并通过安全渠道交付，客户端不会持久化保存。')} />
                <dl><div><dt>{t('企业标识')}</dt><dd>{credential.tenantCode}</dd></div><div><dt>{t('管理员账号')}</dt><dd>{credential.account}</dd></div><div><dt>{t('激活令牌')}</dt><dd>{credential.invitationToken}</dd></div></dl>
                <Button block onClick={() => void navigator.clipboard.writeText(t('激活凭证文本', { tenantCode: credential.tenantCode, account: credential.account, token: credential.invitationToken })).then(() => message.success(t('激活凭证已复制')))}>{t('复制全部凭证')}</Button>
            </div>}
        </Modal>
        <PlatformTenantDetails tenantId={selectedTenantId} permissions={context.administrator.permissions} onClose={() => setSelectedTenantId(undefined)} onSessionExpired={onSessionExpired} />
    </main>;
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