import { GlobalOutlined } from '@ant-design/icons';
import { Select } from 'antd';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { dictionaries } from './i18n-dictionaries';

export type Language = 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP';
export type TranslationParams = Record<string, string | number>;

const LANGUAGE_KEY = 'cees.preferences.language';
const DATE_LOCALES: Record<Language, string> = { 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', 'en-US': 'en-US', 'ja-JP': 'ja-JP' };

function translate(language: Language, key: string, params?: TranslationParams): string {
    let text = dictionaries[language][key] ?? key;
    if (params) for (const [name, value] of Object.entries(params)) text = text.split(`{${name}}`).join(String(value));
    return text;
}

interface I18nContextValue {
    language: Language;
    languages: Array<{ label: string; value: Language }>;
    t: (key: string, params?: TranslationParams) => string;
    setLanguage: (language: Language) => void;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
    const [language, setLanguageState] = useState<Language>(() => readLanguage());

    useEffect(() => {
        document.documentElement.lang = language;
    }, [language]);

    const value = useMemo<I18nContextValue>(() => ({
        language,
        languages: [
            { label: '简体中文', value: 'zh-CN' },
            { label: '繁體中文', value: 'zh-TW' },
            { label: 'English', value: 'en-US' },
            { label: '日本語', value: 'ja-JP' },
        ],
        t: (key, params) => translate(language, key, params),
        setLanguage: (nextLanguage) => {
            localStorage.setItem(LANGUAGE_KEY, nextLanguage);
            setLanguageState(nextLanguage);
        },
    }), [language]);
    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
    const context = useContext(I18nContext);
    if (!context) throw new Error('useI18n must be used inside I18nProvider');
    return context;
}

export function LanguageSwitcher(): JSX.Element {
    const { language, languages, setLanguage } = useI18n();
    return <Select className="language-switcher" suffixIcon={<GlobalOutlined />} value={language} options={languages} onChange={setLanguage} popupMatchSelectWidth={false} />;
}

/** 返回跟随当前界面语言的日期格式化函数；withTime 时附带时分。 */
export function useDateFormatter(): (value: string, options?: { withTime?: boolean }) => string {
    const { language } = useI18n();
    return useCallback((value: string, options?: { withTime?: boolean }) => new Intl.DateTimeFormat(
        DATE_LOCALES[language],
        options?.withTime ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' } : { year: 'numeric', month: '2-digit', day: '2-digit' },
    ).format(new Date(value)), [language]);
}

function readLanguage(): Language {
    const value = localStorage.getItem(LANGUAGE_KEY);
    return value === 'zh-TW' || value === 'en-US' || value === 'ja-JP' ? value : 'zh-CN';
}
