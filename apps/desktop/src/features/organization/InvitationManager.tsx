import { CopyOutlined, DeleteOutlined, ReloadOutlined, UserAddOutlined } from '@ant-design/icons';
import { Alert, App as AntdApp, Button, Empty, Form, Input, Modal, Select, Spin, Tabs, Tag } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
    createTenantInvitation, listTenantInvitations, listTenantRoles, revokeTenantInvitation,
    suggestTenantAccount, type CreateTenantInvitationInput,
} from '../../core/api';
import { useDateFormatter, useI18n } from '../../core/i18n';

interface InvitationCredential {
    tenantCode: string;
    account: string;
    invitationToken: string;
}

export default function InvitationManager({ open, tenantCode, onClose }: { open: boolean; tenantCode: string; onClose: () => void }): JSX.Element {
    const [activeTab, setActiveTab] = useState('list');
    const [credential, setCredential] = useState<InvitationCredential>();
    const [form] = Form.useForm<CreateTenantInvitationInput>();
    const { message, modal } = AntdApp.useApp();
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    const queryClient = useQueryClient();
    const invitationsQuery = useQuery({ queryKey: ['tenant-invitations'], queryFn: listTenantInvitations, enabled: open });
    const rolesQuery = useQuery({ queryKey: ['tenant-roles'], queryFn: listTenantRoles, enabled: open });
    const suggestionMutation = useMutation({
        mutationFn: suggestTenantAccount,
        onSuccess: (result) => {
            const account = result.account ?? result.suggestedAccount ?? result.alternatives?.[0] ?? result.suggestions?.[0];
            if (account) form.setFieldValue('account', account);
            else message.warning(t('服务端未返回可用账号建议'));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t('生成账号建议失败')),
    });
    const createMutation = useMutation({
        mutationFn: createTenantInvitation,
        onSuccess: (result, variables) => {
            const invitationToken = findStringByKey(result, 'invitationToken');
            const account = findStringByKey(result, 'account') ?? variables.account ?? t('由系统生成');
            if (invitationToken) setCredential({ tenantCode, account, invitationToken });
            else message.warning(t('邀请已创建，但响应中未找到一次性激活令牌'));
            form.resetFields();
            setActiveTab('list');
            void queryClient.invalidateQueries({ queryKey: ['tenant-invitations'] });
            message.success(t('成员邀请已创建'));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t('创建邀请失败')),
    });
    const revokeMutation = useMutation({
        mutationFn: revokeTenantInvitation,
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['tenant-invitations'] });
            message.success(t('邀请已撤销'));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t('撤销邀请失败')),
    });

    const generateSuggestion = (): void => {
        const displayName = form.getFieldValue('displayName');
        if (!displayName?.trim()) {
            message.info(t('请先输入成员姓名'));
            return;
        }
        suggestionMutation.mutate(displayName);
    };

    return <>
        <Modal title={t('成员邀请管理')} open={open} onCancel={onClose} footer={null} width={760} destroyOnHidden>
            <Alert className="invitation-tenant-notice" type="info" showIcon message={t('当前企业：{tenant}', { tenant: tenantCode })} description={t('受邀同事只会加入当前登录企业，邀请请求不允许指定其他租户。')} />
            <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
                {
                    key: 'list',
                    label: t('邀请记录 {count}', { count: invitationsQuery.data?.items?.length ?? 0 }),
                    children: <div className="invitation-list">
                        {invitationsQuery.isLoading ? <div className="invitation-loading"><Spin /></div> : invitationsQuery.data?.items?.length ? invitationsQuery.data.items.map((invitation) => <div className="invitation-row" key={invitation.id}>
                            <span><strong>{invitation.displayName}</strong><small>{invitation.account}</small></span>
                            <span>{invitation.roles?.map((role) => role.name).join('、') || t(invitation.isInitialAdministrator ? '首位管理员' : '待分配角色')}</span>
                            <span><Tag color={statusColor(invitation.status)}>{t(statusLabel(invitation.status))}</Tag><small>{t('{date} 到期', { date: formatDate(invitation.expiresAt) })}</small></span>
                            <Button type="text" danger icon={<DeleteOutlined />} disabled={invitation.status !== 'PENDING'} loading={revokeMutation.isPending} onClick={() => modal.confirm({ title: t('撤销该邀请？'), content: t('撤销后原激活令牌立即失效。'), okText: t('撤销邀请'), okButtonProps: { danger: true }, cancelText: t('取消'), onOk: () => revokeMutation.mutateAsync(invitation.id) })} />
                        </div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无邀请记录')} />}
                    </div>,
                },
                {
                    key: 'create',
                    label: t('邀请新成员'),
                    children: <Form<CreateTenantInvitationInput> className="invitation-form" form={form} layout="vertical" requiredMark={false} onFinish={(values) => createMutation.mutate(values)}>
                        <Form.Item name="displayName" label={t('成员姓名')} rules={[{ required: true, message: t('请输入成员姓名') }, { max: 120 }]}><Input placeholder={t('例如：张三')} /></Form.Item>
                        <Form.Item label={t('登录账号')}>
                            <div className="account-suggestion-field"><Form.Item name="account" noStyle rules={[{ min: 3, max: 32 }, { pattern: /^[a-zA-Z0-9]*$/, message: t('账号仅支持英文字母和数字') }]}><Input placeholder={t('可留空由服务端生成')} /></Form.Item><Button icon={<ReloadOutlined />} loading={suggestionMutation.isPending} onClick={generateSuggestion}>{t('生成建议')}</Button></div>
                        </Form.Item>
                        <Form.Item name="roleIds" label={t('成员角色')} rules={[{ required: true, message: t('请选择至少一个角色') }]}><Select mode="multiple" loading={rolesQuery.isLoading} placeholder={t('选择激活后分配的角色')} options={(rolesQuery.data?.items ?? []).map((role) => ({ label: role.name, value: role.id }))} /></Form.Item>
                        <Alert type="info" showIcon message={t('邀请创建后会生成一次性激活令牌')} description={t('请将企业标识、账号和令牌通过安全渠道交付给成员。')} />
                        <Button className="invitation-submit" type="primary" htmlType="submit" icon={<UserAddOutlined />} loading={createMutation.isPending}>{t('创建邀请')}</Button>
                    </Form>,
                },
            ]} />
        </Modal>
        <Modal title={t('成员激活凭证')} open={Boolean(credential)} closable={false} maskClosable={false} onCancel={() => setCredential(undefined)} footer={<Button type="primary" onClick={() => setCredential(undefined)}>{t('我已安全保存')}</Button>}>
            {credential && <div className="one-time-credential">
                <Alert type="warning" showIcon message={t('激活令牌只显示一次')} description={t('关闭后客户端不会保留，请先复制并安全交付。')} />
                <dl><div><dt>{t('企业标识')}</dt><dd>{credential.tenantCode}</dd></div><div><dt>{t('成员账号')}</dt><dd>{credential.account}</dd></div><div><dt>{t('激活令牌')}</dt><dd>{credential.invitationToken}</dd></div></dl>
                <Button block icon={<CopyOutlined />} onClick={() => void navigator.clipboard.writeText(t('激活凭证文本', { tenantCode: credential.tenantCode, account: credential.account, token: credential.invitationToken })).then(() => message.success(t('激活凭证已复制')))}>{t('复制全部凭证')}</Button>
            </div>}
        </Modal>
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

function statusColor(status: string): string {
    if (status === 'PENDING') return 'blue';
    if (status === 'ACCEPTED') return 'green';
    if (status === 'REVOKED') return 'red';
    return 'default';
}

function statusLabel(status: string): string {
    return { PENDING: '待激活', ACCEPTED: '已接受', REVOKED: '已撤销', EXPIRED: '已过期' }[status] ?? status;
}