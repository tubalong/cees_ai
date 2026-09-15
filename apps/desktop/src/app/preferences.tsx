import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type FontSizeMode = 'small' | 'standard' | 'large';

interface PreferencesContextValue {
    themeMode: ThemeMode;
    resolvedTheme: 'light' | 'dark';
    fontSize: FontSizeMode;
    fontScale: number;
    setThemeMode: (mode: ThemeMode) => void;
    setFontSize: (mode: FontSizeMode) => void;
}

const THEME_KEY = 'cees.preferences.theme';
const FONT_SIZE_KEY = 'cees.preferences.fontSize';
const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined);

export function PreferencesProvider({ children }: { children: ReactNode }): JSX.Element {
    const [themeMode, setThemeModeState] = useState<ThemeMode>(() => readThemeMode());
    const [fontSize, setFontSizeState] = useState<FontSizeMode>(() => readFontSize());
    const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => getSystemTheme());
    const resolvedTheme = themeMode === 'system' ? systemTheme : themeMode;
    const fontScale = fontSize === 'small' ? 0.9 : fontSize === 'large' ? 1.12 : 1;

    useEffect(() => {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = (): void => setSystemTheme(media.matches ? 'dark' : 'light');
        media.addEventListener('change', handleChange);
        return () => media.removeEventListener('change', handleChange);
    }, []);

    useEffect(() => {
        document.documentElement.dataset.theme = resolvedTheme;
        document.documentElement.style.colorScheme = resolvedTheme;
    }, [resolvedTheme]);

    useEffect(() => {
        document.documentElement.dataset.fontSize = fontSize;
        if (window.cees?.setZoomFactor) {
            window.cees.setZoomFactor(fontScale);
            document.body.style.zoom = '';
        } else {
            document.body.style.zoom = fontScale === 1 ? '' : String(fontScale);
        }
    }, [fontScale, fontSize]);

    const value = useMemo<PreferencesContextValue>(() => ({
        themeMode,
        resolvedTheme,
        fontSize,
        fontScale,
        setThemeMode: (mode) => {
            localStorage.setItem(THEME_KEY, mode);
            setThemeModeState(mode);
        },
        setFontSize: (mode) => {
            localStorage.setItem(FONT_SIZE_KEY, mode);
            setFontSizeState(mode);
        },
    }), [fontScale, fontSize, resolvedTheme, themeMode]);

    return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
    const context = useContext(PreferencesContext);
    if (!context) throw new Error('usePreferences must be used inside PreferencesProvider');
    return context;
}

function readThemeMode(): ThemeMode {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'dark' || value === 'system' ? value : 'light';
}

function readFontSize(): FontSizeMode {
    const value = localStorage.getItem(FONT_SIZE_KEY);
    return value === 'small' || value === 'large' ? value : 'standard';
}

function getSystemTheme(): 'light' | 'dark' {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}