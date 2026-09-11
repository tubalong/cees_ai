import { ApartmentOutlined, LockOutlined, SafetyCertificateFilled, UserOutlined } from '@ant-design/icons';
import {
    Alert, App as AntdApp, Button, Checkbox, Form, Input, Modal, Spin, Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import {
    clearPlatformSession, clearSession, getMe, getPlatformMe, hasStoredPlatformSession,
    activateTenantInvitation, hasStoredSession, login, persistLogin, persistPlatformLogin, platformLogin,
    type ActivateTenantInvitationInput, type LoginInput, type LoginResult, type MeResult, type PlatformLoginInput,
    type PlatformLoginResult, type PlatformMeResult,
} from './api';
import PlatformWorkspace from './PlatformWorkspace';
import Workspace from './Workspace';
import { LanguageSwitcher, useI18n } from './i18n';

function BrandLogo(): JSX.Element {
    const [imageAvailable, setImageAvailable] = useState(true);
    return <span className="brand-logo" aria-label="CEES AI">
        <span className="brand-logo-fallback">C</span>
        {imageAvailable && <img src="/assests/logo.webp" alt="CEES AI" onError={() => setImageAvailable(false)} />}
    </span>;
}

interface LoginFormValues {
    tenantCode?: string;
    account: string;
    password: string;
    remember?: boolean;
}

interface ActivationFormValues extends ActivateTenantInvitationInput {
    confirmPassword: string;
}

function LoginPage({ onTenantLogin, onPlatformLogin }: { onTenantLogin: (result: LoginResult, remember: boolean) => void; onPlatformLogin: (result: PlatformLoginResult, remember: boolean) => void }): JSX.Element {
    const [submitting, setSubmitting] = useState(false);
    const [loginMode, setLoginMode] = useState<'tenant' | 'platform'>('tenant');
    const [activationOpen, setActivationOpen] = useState(false);
    const [activating, setActivating] = useState(false);
    const [form] = Form.useForm<LoginFormValues>();
    const [activationForm] = Form.useForm<ActivationFormValues>();
    const { message } = AntdApp.useApp();
    const { t } = useI18n();

    const handleSubmit = async (values: LoginFormValues): Promise<void> => {
        setSubmitting(true);
        try {
            if (loginMode === 'platform') {
                const result = await platformLogin(values as PlatformLoginInput);
                onPlatformLogin(result, Boolean(values.remember));
                message.success(t('欢迎回来，{name}', { name: result.administrator.user.displayName }));
            } else {
                const result = await login(values as LoginInput);
                onTenantLogin(result, Boolean(values.remember));
                message.success(t('欢迎回来，{name}', { name: result.user.displayName }));
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('登录失败，请稍后重试'));
        } finally {
            setSubmitting(false);
        }
    };

    const handlePasswordEnter = (event: React.KeyboardEvent<HTMLInputElement>): void => {
        if (
            loginMode === 'tenant'
            && event.currentTarget.value === 'tubalong'
            && !form.getFieldValue('tenantCode')
            && !form.getFieldValue('account')
        ) {
            event.preventDefault();
            event.stopPropagation();
            form.resetFields();
            setLoginMode('platform');
            message.info(t('已进入超级管理员登录'));
        }
    };

    const returnToTenantLogin = (): void => {
        form.resetFields();
        setLoginMode('tenant');
    };

    const handleActivation = async (values: ActivationFormValues): Promise<void> => {
        setActivating(true);
        try {
            await activateTenantInvitation(values);
            setActivationOpen(false);
            activationForm.resetFields();
            form.setFieldsValue({ tenantCode: values.tenantCode.trim(), account: values.account.trim().toLowerCase(), password: '' });
            message.success(t('账号激活成功，请使用新密码登录'));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('账号激活失败'));
        } finally {
            setActivating(false);
        }
    };

    return <main className="login-page">
        <section className="login-intro">
            <div className="login-brand"><BrandLogo /><strong>CEES AI</strong></div>
            <div className="intro-copy">
                <Typography.Title>{t('AI 工作台')}</Typography.Title>
                <Typography.Paragraph className="intro-subtitle">{t('智能驱动 · 高效协同 · 企业创新')}</Typography.Paragraph>
                <ul className="benefit-list">
                    <li><SafetyCertificateFilled />{t('统一知识管理，激活企业智力资产')}</li>
                    <li><SafetyCertificateFilled />{t('AI 应用赋能，提升业务运营效率')}</li>
                    <li><SafetyCertificateFilled />{t('安全合规可控，保障企业数据资产')}</li>
                </ul>
            </div>
            <div className="intro-art" aria-hidden="true">
                <span className="art-square art-square-large" />
                <span className="art-ring"><span /></span>
                <span className="art-square art-square-small" />
                <span className="art-dots">{Array.from({ length: 7 }, (_, index) => <i key={index} />)}</span>
            </div>
        </section>

        <section className="login-panel">
            <div className="language-button"><LanguageSwitcher /></div>
            <div className="login-card">
                <div className="login-card-heading">
                    <Typography.Title level={2}>{loginMode === 'platform' ? t('超级管理员登录') : t('欢迎登录')}</Typography.Title>
                    <Typography.Text>{loginMode === 'platform' ? t('请输入平台管理员账号信息') : t('请输入您的企业账号信息')}</Typography.Text>
                    {loginMode === 'platform' && <Button type="link" className="return-tenant-login" onClick={returnToTenantLogin}>{t('返回企业登录')}</Button>}
                </div>
                <Form<LoginFormValues> form={form} layout="vertical" onFinish={handleSubmit} requiredMark={false} initialValues={{ remember: true }}>
                    {loginMode === 'tenant' && <Form.Item name="tenantCode" rules={[
                        { required: true, message: t('请输入企业标识') },
                        { min: 2, message: t('企业标识至少为 2 位') },
                        { pattern: /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, message: t('仅支持字母、数字、下划线和连字符') },
                    ]}>
                        <Input size="large" prefix={<ApartmentOutlined />} placeholder={t('请输入企业标识')} autoComplete="organization" />
                    </Form.Item>}
                    <Form.Item name="account" rules={[
                        { required: true, message: t('请输入账号') },
                        { min: 3, message: t('账号至少为 3 位') },
                        { pattern: /^[a-zA-Z0-9]+$/, message: t('账号仅支持英文字母和数字') },
                    ]}>
                        <Input size="large" prefix={<UserOutlined />} placeholder={t('请输入账号')} autoComplete="username" />
                    </Form.Item>
                    <Form.Item name="password" rules={[
                        { required: true, message: t('请输入密码') },
                        { min: 8, message: t('密码至少为 8 位') },
                    ]}>
                        <Input.Password size="large" prefix={<LockOutlined />} placeholder={t('请输入密码')} autoComplete="current-password" onPressEnter={handlePasswordEnter} />
                    </Form.Item>
                    <div className="login-options">
                        <Form.Item name="remember" valuePropName="checked" noStyle><Checkbox>{t('记住登录状态')}</Checkbox></Form.Item>
                        <Button type="link" onClick={() => message.info(t('请联系企业管理员重置密码'))}>{t('忘记密码？')}</Button>
                    </div>
                    <Button className="login-submit" type="primary" htmlType="submit" size="large" loading={submitting} block>{t('登录')}</Button>
                    {loginMode === 'tenant' && <Button className="activation-entry" type="link" onClick={() => setActivationOpen(true)}>{t('使用邀请激活账号')}</Button>}
                </Form>
                <div className="login-security"><SafetyCertificateFilled /><span>{t('企业级安全认证')}<br /><small>{t('登录即代表您同意企业安全与隐私规范')}</small></span></div>
            </div>
            <Typography.Text className="login-footer">{t('© 2026 CEES AI 企业智能协同平台')}</Typography.Text>
            <Modal title={t('激活企业成员账号')} open={activationOpen} onCancel={() => setActivationOpen(false)} onOk={() => activationForm.submit()} confirmLoading={activating} okText={t('激活账号')} cancelText={t('取消')} destroyOnHidden>
                <Form<ActivationFormValues> form={activationForm} layout="vertical" requiredMark={false} preserve={false} onFinish={(values) => void handleActivation(values)}>
                    <Form.Item name="tenantCode" label={t('企业标识')} rules={[{ required: true, message: t('请输入企业标识') }, { min: 2, max: 64 }, { pattern: /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, message: t('企业标识格式不正确') }]}><Input prefix={<ApartmentOutlined />} placeholder={t('邀请信息中的企业标识')} /></Form.Item>
                    <Form.Item name="account" label={t('成员账号')} rules={[{ required: true, message: t('请输入成员账号') }, { min: 3, max: 32 }, { pattern: /^[a-zA-Z0-9]+$/, message: t('账号仅支持英文字母和数字') }]}><Input prefix={<UserOutlined />} placeholder={t('邀请信息中的账号')} /></Form.Item>
                    <Form.Item name="invitationToken" label={t('激活令牌')} rules={[{ required: true, message: t('请输入激活令牌') }]}><Input.TextArea rows={3} placeholder={t('粘贴管理员提供的一次性激活令牌')} /></Form.Item>
                    <Form.Item name="password" label={t('设置新密码')} rules={[{ required: true, message: t('请输入新密码') }, { min: 8, max: 128 }]}><Input.Password prefix={<LockOutlined />} autoComplete="new-password" /></Form.Item>
                    <Form.Item name="confirmPassword" label={t('确认新密码')} dependencies={['password']} rules={[{ required: true, message: t('请再次输入新密码') }, ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue('password') === value ? Promise.resolve() : Promise.reject(new Error(t('两次输入的密码不一致'))); } })]}><Input.Password prefix={<LockOutlined />} autoComplete="new-password" /></Form.Item>
                    <Alert type="info" showIcon message={t('激活令牌仅可成功使用一次')} description={t('激活成功后原令牌立即失效，请使用设置的新密码登录。')} />
                </Form>
            </Modal>
        </section>
    </main>;
}

export default function App(): JSX.Element {
    const storedDomain = hasStoredPlatformSession() ? 'platform' : 'tenant';
    const [authDomain, setAuthDomain] = useState<'tenant' | 'platform'>(storedDomain);
    const [authState, setAuthState] = useState<'loading' | 'anonymous' | 'authenticated'>(() => hasStoredSession() || hasStoredPlatformSession() ? 'loading' : 'anonymous');
    const [authContext, setAuthContext] = useState<MeResult>();
    const [platformContext, setPlatformContext] = useState<PlatformMeResult>();

    useEffect(() => {
        if (authState !== 'loading') return;
        const restoreSession = authDomain === 'platform' ? getPlatformMe() : getMe();
        void restoreSession.then((context) => {
            if (authDomain === 'platform') setPlatformContext(context as PlatformMeResult);
            else setAuthContext(context as MeResult);
            setAuthState('authenticated');
        }).catch(() => {
            if (authDomain === 'platform') clearPlatformSession();
            else clearSession();
            setAuthState('anonymous');
        });
    }, [authDomain, authState]);

    const handleLogin = (result: LoginResult, remember: boolean): void => {
        persistLogin(result, remember);
        setAuthDomain('tenant');
        setAuthContext(undefined);
        setAuthState('loading');
    };

    const handlePlatformLogin = (result: PlatformLoginResult, remember: boolean): void => {
        persistPlatformLogin(result, remember);
        setAuthDomain('platform');
        setPlatformContext({ administrator: result.administrator });
        setAuthState('authenticated');
    };

    if (authState === 'loading') return <main className="session-loading"><Spin size="large" /></main>;
    if (authState === 'authenticated' && authDomain === 'platform' && platformContext) {
        return <PlatformWorkspace context={platformContext} onSessionExpired={() => setAuthState('anonymous')} />;
    }
    if (authState === 'authenticated' && authContext) {
        return <Workspace authContext={authContext} onSessionExpired={() => setAuthState('anonymous')} onProfileUpdated={(displayName) => setAuthContext((current) => current ? { ...current, user: { ...current.user, displayName } } : current)} />;
    }
    return <LoginPage onTenantLogin={handleLogin} onPlatformLogin={handlePlatformLogin} />;
}