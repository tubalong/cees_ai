import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntdApp, ConfigProvider, theme as antdTheme } from 'antd';
import enUS from 'antd/locale/en_US';
import jaJP from 'antd/locale/ja_JP';
import zhCN from 'antd/locale/zh_CN';
import zhTW from 'antd/locale/zh_TW';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { PreferencesProvider, usePreferences } from './preferences';
import { I18nProvider, useI18n } from './i18n';
import './styles.css';
import './login.css';
import './workspace.css';
import './platform.css';
import './invitation.css';
import './department.css';
import './profile.css';
import './role.css';
import './preferences.css';
import './platform-tenant.css';

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

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <PreferencesProvider><I18nProvider><ThemedApplication /></I18nProvider></PreferencesProvider>
    </React.StrictMode>,
);