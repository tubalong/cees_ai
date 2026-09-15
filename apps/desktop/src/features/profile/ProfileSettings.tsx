import { ApartmentOutlined, DesktopOutlined, FontSizeOutlined, KeyOutlined, MoonOutlined, SafetyCertificateOutlined, SunOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, App as AntdApp, Avatar, Button, Form, Input, Modal, Segmented, Spin, Tag } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { changePassword, getUserProfile, hasStoredSession, updateUserProfile, type ChangePasswordInput } from '../../core/api';
import { usePreferences } from '../../app/preferences';
import { LanguageSwitcher, useDateFormatter, useI18n } from '../../core/i18n';

interface ProfileFormValues {
    displayName: string;
}

interface PasswordFormValues extends ChangePasswordInput {
    confirmPassword: string;
}

export default function ProfileSettings({ tenantName, onProfileUpdated, onSessionExpired }: { tenantName: string; onProfileUpdated: (displayName: string) => void; onSessionExpired: () => void }): JSX.Element {
    const [passwordOpen, setPasswordOpen] = useState(false);
    const [profileForm] = Form.useForm<ProfileFormValues>();
    const [passwordForm] = Form.useForm<PasswordFormValues>();
    const { message } = AntdApp.useApp();
    const preferences = usePreferences();
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    const queryClient = useQueryClient();
    const profileQuery = useQuery({ queryKey: ['user-profile'], queryFn: getUserProfile });
    const profile = profileQuery.data;

    useEffect(() => {
        if (profile) profileForm.setFieldsValue({ displayName: profile.displayName });
    }, [profile, profileForm]);

    useEffect(() => {
        if (profileQuery.error && !hasStoredSession()) onSessionExpired();
    }, [onSessionExpired, profileQuery.error]);

    const profileMutation = useMutation({
        mutationFn: (values: ProfileFormValues) => updateUserProfile({ displayName: values.displayName, version: profile!.version }),
        onSuccess: (updatedProfile) => {
            queryClient.setQueryData(['user-profile'], updatedProfile);
            onProfileUpdated(updatedProfile.displayName);
            message.success(t('显示名称已更新'));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t('资料更新失败')),
    });
    const passwordMutation = useMutation({
        mutationFn: ({ currentPassword, newPassword }: PasswordFormValues) => changePassword({ currentPassword, newPassword }),
        onSuccess: () => {
            setPasswordOpen(false);
            passwordForm.resetFields();
            message.success(t('密码修改成功，其他设备会话已撤销'));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t('密码修改失败')),
    });

    if (profileQuery.isLoading) return <div className="profile-page-loading"><Spin size="large" /></div>;
    if (!profile) return <div className="profile-page-loading"><Alert type="error" showIcon message={t('无法加载个人资料')} action={<Button onClick={() => void profileQuery.refetch()}>{t('重试')}</Button>} /></div>;

    return <div className="workspace-page profile-settings-page">
        <header className="workspace-page-header"><div><h1>{t('个人中心')}</h1><p>{t('管理当前企业内的显示名称与登录密码')}</p></div></header>
        <section className="profile-identity-panel">
            <Avatar size={68}>{profile.displayName.slice(-1)}</Avatar>
            <div><h2>{profile.displayName}</h2><p>{profile.account} · {tenantName}</p><Tag color="green">{t('当前企业成员')}</Tag></div>
        </section>
        <div className="profile-settings-grid">
            <section className="profile-setting-panel">
                <div className="profile-setting-heading"><i><UserOutlined /></i><div><h2>{t('个人资料')}</h2><p>{t('显示名称仅在当前企业内生效')}</p></div></div>
                <Form<ProfileFormValues> form={profileForm} layout="vertical" requiredMark={false} onFinish={(values) => profileMutation.mutate(values)}>
                    <Form.Item name="displayName" label={t('显示名称')} rules={[{ required: true, message: t('请输入显示名称') }, { min: 1, max: 120 }]}><Input prefix={<UserOutlined />} /></Form.Item>
                    <Form.Item label={t('登录账号')}><Input prefix={<SafetyCertificateOutlined />} value={profile.account} disabled /></Form.Item>
                    <Form.Item label={t('所属部门')}><Input prefix={<ApartmentOutlined />} value={profile.department?.name ?? t('未分配部门')} disabled /></Form.Item>
                    <Button type="primary" htmlType="submit" loading={profileMutation.isPending}>{t('保存资料')}</Button>
                </Form>
            </section>
            <section className="profile-setting-panel security-panel">
                <div className="profile-setting-heading"><i><KeyOutlined /></i><div><h2>{t('账号安全')}</h2><p>{t('定期更新密码，降低账号泄露风险')}</p></div></div>
                <Alert type="info" showIcon message={t('修改密码后，其他设备上的登录会话会立即撤销')} description={t('当前设备的会话会保留，可以继续工作。')} />
                <dl><div><dt>{t('资料版本')}</dt><dd>v{profile.version}</dd></div><div><dt>{t('最近更新')}</dt><dd>{formatDate(profile.updatedAt, { withTime: true })}</dd></div></dl>
                <Button icon={<KeyOutlined />} onClick={() => setPasswordOpen(true)}>{t('修改密码')}</Button>
            </section>
            <section className="profile-setting-panel personalization-panel">
                <div className="profile-setting-heading"><i><SunOutlined /></i><div><h2>{t('界面个性化')}</h2><p>{t('设置保存在当前设备，重启客户端后继续生效')}</p></div></div>
                <div className="preference-setting-row"><div><strong>{t('界面语言')}</strong><small>{t('支持简体中文、繁体中文、英文和日文')}</small></div><LanguageSwitcher /></div>
                <div className="preference-setting-row">
                    <div><strong>{t('外观主题')}</strong><small>{t('选择浅色、深色或跟随操作系统')}</small></div>
                    <Segmented value={preferences.themeMode} onChange={preferences.setThemeMode} options={[
                        { label: t('浅色'), value: 'light', icon: <SunOutlined /> },
                        { label: t('深色'), value: 'dark', icon: <MoonOutlined /> },
                        { label: t('跟随系统'), value: 'system', icon: <DesktopOutlined /> },
                    ]} />
                </div>
                <div className="preference-setting-row">
                    <div><strong>{t('字体大小')}</strong><small>{t('同步调整文字和控件比例，保证页面布局一致')}</small></div>
                    <Segmented value={preferences.fontSize} onChange={preferences.setFontSize} options={[
                        { label: t('小'), value: 'small', icon: <FontSizeOutlined /> },
                        { label: t('标准'), value: 'standard', icon: <FontSizeOutlined /> },
                        { label: t('大'), value: 'large', icon: <FontSizeOutlined /> },
                    ]} />
                </div>
            </section>
        </div>
        <Modal title={t('修改登录密码')} open={passwordOpen} onCancel={() => setPasswordOpen(false)} onOk={() => passwordForm.submit()} confirmLoading={passwordMutation.isPending} okText={t('确认修改')} cancelText={t('取消')} destroyOnHidden>
            <Form<PasswordFormValues> form={passwordForm} layout="vertical" requiredMark={false} preserve={false} onFinish={(values) => passwordMutation.mutate(values)}>
            <Form.Item name="currentPassword" label={t('当前密码')} rules={[{ required: true, message: t('请输入当前密码') }, { min: 8, max: 128 }]}><Input.Password autoComplete="current-password" /></Form.Item>
            <Form.Item name="newPassword" label={t('新密码')} rules={[{ required: true, message: t('请输入新密码') }, { min: 8, max: 128 }]}><Input.Password autoComplete="new-password" /></Form.Item>
            <Form.Item name="confirmPassword" label={t('确认新密码')} dependencies={['newPassword']} rules={[{ required: true, message: t('请再次输入新密码') }, ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue('newPassword') === value ? Promise.resolve() : Promise.reject(new Error(t('两次输入的新密码不一致'))); } })]}><Input.Password autoComplete="new-password" /></Form.Item>
            <Alert type="warning" showIcon message={t('新密码生效后，其他会话将无法继续访问')} />
            </Form>
        </Modal>
    </div>;
}

