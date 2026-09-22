import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntdApp, ConfigProvider, theme as antdTheme } from 'antd';
import enUS from 'antd/locale/en_US';
import jaJP from 'antd/locale/ja_JP';
import zhCN from 'antd/locale/zh_CN';
import zhTW from 'antd/locale/zh_TW';
import { HashRouter } from 'react-router-dom';
import App from './app/App';
import { hydrateSecureSession } from './core/api';
import { PreferencesProvider, PlatformWindowChrome, usePreferences } from './app/preferences';
import { I18nProvider, useI18n } from './core/i18n';
import './styles/styles.css';
import './app/login.css';
import './app/workspace.css';
import './features/platform/platform.css';
import './features/organization/invitation.css';
import './features/organization/department.css';
import './features/profile/profile.css';
import './features/roles/role.css';
import './app/preferences.css';
import './features/platform/platform-tenant.css';
import './features/dingtalk/dingtalk.css';
import './features/connectors/connectors.css';

const queryClient = new QueryClient();

function ThemedApplication(): JSX.Element {
    const preferences = usePreferences();
    const { language } = useI18n();
    const locale = language === 'en-US' ? enUS : language === 'ja-JP' ? jaJP : language === 'zh-TW' ? zhTW : zhCN;
    return <ConfigProvider theme={{
        algorithm: preferences.resolvedTheme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
            colorPrimary: '#565cf6',
            borderRadius: 6,
            fontFamily: '"Manrope", "Noto Sans SC", sans-serif',
            fontSize: preferences.fontSize === 'small' ? 13 : preferences.fontSize === 'large' ? 16 : 14,
        },
    }} locale={locale}>
        <AntdApp><QueryClientProvider client={queryClient}><HashRouter><App /></HashRouter></QueryClientProvider></AntdApp>
    </ConfigProvider>;
}

/**
 * 先把手机会话从加密存储解密到内存镜像，再渲染应用：
 * 否则首屏的会话校验会因为令牌尚未就绪而把已登录用户误判为未登录。
 * hydrateSecureSession 内部已捕获异常（解密失败按未登录处理），不会阻塞启动。
 */
void hydrateSecureSession().finally(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <PreferencesProvider><I18nProvider><ThemedApplication /><PlatformWindowChrome /></I18nProvider></PreferencesProvider>
        </React.StrictMode>,
    );
});
