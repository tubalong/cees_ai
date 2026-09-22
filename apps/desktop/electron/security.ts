import { app, ipcMain, shell, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, type Session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEV_CSP, PRODUCTION_CSP } from './csp';

/**
 * 渲染层安全基线。
 *
 * 桌面端同时承担「企业业务界面」与「本地连接器（DWS / 未来本机工具）」两类职责，
 * 一旦渲染层出现 XSS，攻击面不只是页面，还包括已通过 contextBridge 暴露的 IPC。
 * 因此这里补齐四道闸门：
 *   1. CSP：限制脚本/样式/连接/内嵌来源，阻断注入脚本执行与数据外发；
 *   2. IPC 来源校验：只有应用自身页面能调用 IPC，子框架与其他来源一律拒绝；
 *   3. 导航锁定：应用窗口不会导航到外部站点，外链一律交给系统浏览器；
 *   4. webview 策略：浏览器页签允许 http(s)，但强制关闭 node 集成并清除 preload。
 *
 * CSP 的下发分工（详见 `./csp`）：
 *   - 打包后页面通过 file:// 加载，file:// 请求**不经过** webRequest，
 *     因此只能由构建时注入 index.html 的 meta 承担（严格策略）；
 *   - 开发期页面由 Vite dev server 提供，这里以响应头下发 dev 变体
 *     （多放行 inline 脚本，否则 React Refresh 的 preamble 会被拦下、页面白屏）。
 */

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';

/** 打包产物使用的严格策略（由 vite.config.ts 注入 index.html）。 */
export const CONTENT_SECURITY_POLICY = PRODUCTION_CSP;

/**
 * 开发期策略：只多放行 inline 脚本（React Refresh 的 preamble 是内联模块脚本）。
 * 该放宽仅存在于 dev server 的响应头，**不会进入打包产物**。
 */
export const DEV_CONTENT_SECURITY_POLICY = DEV_CSP;

/** 打包后渲染层的入口文件 URL；用于判定「页面来源是否属于本应用」。 */
function packagedIndexUrl(): string {
    return pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
}

/**
 * 判定页面 URL 是否属于本应用自身。
 * 开发期只信任 Vite dev server；打包后只信任 dist 入口（含 HashRouter 的 `#/...`）。
 */
export function isTrustedPageUrl(url: string): boolean {
    if (!url) return false;
    if (!app.isPackaged) return url.startsWith(DEV_SERVER_URL);
    return url.startsWith(packagedIndexUrl());
}

/**
 * IPC 来源校验。所有 ipcMain 处理函数必须先过这道闸门：
 * 子框架（例如注入的 iframe）的 senderFrame 不是主文档，会被这里拒绝。
 */
export function assertTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): void {
    const url = event.senderFrame?.url ?? '';
    if (!isTrustedPageUrl(url)) {
        throw new Error('IPC 调用来源不可信，已拒绝执行');
    }
}

/**
 * 统一 IPC 来源校验。
 *
 * 包裹一次 `ipcMain.handle`，使**所有**通道（包含后续新增的）自动带上来源校验，
 * 避免逐个注册处漏加。集中包裹优于逐处调用：漏一个是常见的真实缺陷。
 */
export function installIpcSenderGuard(): void {
    const original = ipcMain.handle.bind(ipcMain);
    type TrustedListener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
    ipcMain.handle = ((channel: string, listener: TrustedListener) =>
        original(channel, (event, ...args) => {
            assertTrustedSender(event);
            return listener(event, ...args);
        })) as typeof ipcMain.handle;
}

/** 开发期通过响应头下发 CSP，与 index.html 的 meta 策略保持一致。 */
export function installContentSecurityPolicy(session: Session): void {
    if (app.isPackaged) return;
    session.webRequest.onHeadersReceived((details, callback) => {
        if (!details.url.startsWith(DEV_SERVER_URL)) {
            callback({ responseHeaders: details.responseHeaders });
            return;
        }
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [DEV_CONTENT_SECURITY_POLICY],
            },
        });
    });
}

/**
 * 导航锁定与 webview 策略。
 * - will-navigate / will-redirect：应用窗口内部不导航外部站点，外链改用系统浏览器打开；
 * - will-attach-webview：只允许 http(s) 站点，并强制关闭 node 集成、清除 preload，
 *   避免被打开的第三方页面拿到任何本地能力。
 */
export function installNavigationLock(window: BrowserWindow): void {
    const webContents = window.webContents;

    const guardNavigation = (event: Electron.Event, url: string): void => {
        if (isTrustedPageUrl(url)) return;
        // 应用内路由由 HashRouter 处理（只改 hash，不触发 will-navigate），
        // 走到这里说明是真实跳转：一律拦截，外链交给系统浏览器。
        event.preventDefault();
        if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    };
    webContents.on('will-navigate', (event, url) => guardNavigation(event, url));
    webContents.on('will-redirect', (event, url) => guardNavigation(event, url));

    webContents.on('will-attach-webview', (event, webPreferences, params) => {
        delete (webPreferences as { preload?: string }).preload;
        webPreferences.nodeIntegration = false;
        webPreferences.contextIsolation = true;
        webPreferences.sandbox = true;
        if (!/^https?:\/\//i.test(params.src)) event.preventDefault();
    });
}
