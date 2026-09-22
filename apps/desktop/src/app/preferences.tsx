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
        document.documentElement.dataset.platform = detectPlatform();
        document.documentElement.style.colorScheme = resolvedTheme;
    }, [resolvedTheme]);

    /**
     * macOS 全屏时系统会隐藏交通灯，顶部 34px 拖拽留白失去意义。
     * 主进程推送全屏状态，`styles.css` 依据 `:root[data-fullscreen='true']`
     * 将 `--platform-drag-height` 归零并隐藏拖拽层，让各页收回这段留白。
     * Windows / Linux 无该桥接，属性不会写入，相关选择器永不命中。
     */
    useEffect(() => {
        const root = document.documentElement;
        if (detectPlatform() !== 'mac') {
            delete root.dataset.fullscreen;
            return;
        }
        return window.cees?.onFullScreenChanged?.((fullScreen) => {
            root.dataset.fullscreen = String(fullScreen);
        });
    }, []);

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

export type DesktopPlatform = 'mac' | 'windows' | 'linux';

/** 优先使用 Electron 注入的真实平台，在普通浏览器中回退到 UA 探测。 */
export function detectPlatform(): DesktopPlatform {
    const platform = window.cees?.platform;
    if (platform === 'darwin') return 'mac';
    if (platform === 'linux') return 'linux';
    if (platform) return 'windows';
    if (/Macintosh|Mac OS X/i.test(navigator.userAgent)) return 'mac';
    if (/Linux/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent)) return 'linux';
    return 'windows';
}

/**
 * macOS 使用 `titleBarStyle: 'hiddenInset'` 隐藏了原生标题栏，必须由渲染层
 * 提供一个显式拖拽区域，否则用户无法移动主窗口；Windows / Linux 由系统
 * 标题栏负责，因此不渲染。
 */
export function PlatformWindowChrome(): JSX.Element | null {
    if (detectPlatform() !== 'mac') return null;
    return <div className="platform-window-drag" aria-hidden="true" />;
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