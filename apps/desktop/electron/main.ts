import { app, BrowserWindow, ipcMain, Menu, session, shell, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import {
    ConnectorHost,
    type ConnectorStatusChangedEvent,
} from './connectors/core/connector-host';
import { ConnectorRegistry } from './connectors/core/connector-registry';
import { DingTalkConnectorAdapter } from './connectors/dingtalk/dingtalk.adapter';
import { TencentMeetingConnectorAdapter } from './connectors/tencent-meeting/tencent-meeting.adapter';
import { WeComConnectorAdapter } from './connectors/wecom/wecom.adapter';
import { GitHubConnectorAdapter } from './connectors/github/github.adapter';
import {
    installContentSecurityPolicy,
    installIpcSenderGuard,
    installNavigationLock,
} from './security';
import { SecureTokenStore } from './secure-store';

const connectorRegistry = new ConnectorRegistry();
const dingtalkConnector = new DingTalkConnectorAdapter();
const tencentMeetingConnector = new TencentMeetingConnectorAdapter();
const weComConnector = new WeComConnectorAdapter();
const githubConnector = new GitHubConnectorAdapter();
connectorRegistry.register(dingtalkConnector);
connectorRegistry.register(tencentMeetingConnector);
connectorRegistry.register(weComConnector);
connectorRegistry.register(githubConnector);
const connectorHost = new ConnectorHost(connectorRegistry, publishConnectorStatus);

function getDingTalkConnector(): DingTalkConnectorAdapter {
    return dingtalkConnector;
}

function publishConnectorStatus(event: ConnectorStatusChangedEvent): void {
    for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('cees:connector-status-changed', event);
        if (event.connectorId === 'dingtalk') {
            window.webContents.send('cees:dingtalk-connector-status-changed', event.status);
        }
    }
}

/**
 * macOS 必须保留系统应用菜单：一旦置空，⌘Q / ⌘W / ⌘M / ⌘C / ⌘V / ⌘A 等
 * 系统快捷键会全部失效，剪贴板也无法在输入框中工作。
 * Windows / Linux 由应用内自绘导航承担，因此继续置空菜单。
 */
function installApplicationMenu(): void {
    if (process.platform !== 'darwin') {
        Menu.setApplicationMenu(null);
        return;
    }
    const template: MenuItemConstructorOptions[] = [
        { role: 'appMenu' },
        { role: 'editMenu' },
        {
            label: '视图',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
            ],
        },
        {
            label: '窗口',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                { type: 'separator' },
                { role: 'front' },
                { role: 'togglefullscreen' },
            ],
        },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** 为输入框、选中文本与外链补齐右键菜单，符合 macOS 的系统级交互预期。 */
function installContextMenu(window: BrowserWindow): void {
    window.webContents.on('context-menu', (_event, params) => {
        const template: MenuItemConstructorOptions[] = [];
        if (params.isEditable) {
            template.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
        } else if (params.selectionText.trim().length > 0) {
            template.push({ role: 'copy' }, { role: 'selectAll' });
        }
        if (params.linkURL && /^https?:\/\//i.test(params.linkURL)) {
            if (template.length > 0) template.push({ type: 'separator' });
            template.push({ label: '在浏览器中打开链接', click: () => void shell.openExternal(params.linkURL) });
        }
        if (template.length === 0) return;
        Menu.buildFromTemplate(template).popup({ window });
    });
}

function createWindow(): void {
    const isMac = process.platform === 'darwin';
    const window = new BrowserWindow({
        width: 1440,
        height: 900,
        // macOS 下窗口最小宽度放宽到 1040px（与 CSS 的 --desktop-shell-min-width 保持一致）。
        minWidth: isMac ? 1040 : 1100,
        minHeight: 720,
        // 与 CSS 的 `--workspace-bg`（#f4f6f9）保持一致，避免 macOS 圆角窗口
        // 边缘与首帧出现深浅不一致的闪白。
        backgroundColor: '#f4f6f9',
        titleBarStyle: isMac ? 'hiddenInset' : 'default',
        trafficLightPosition: isMac ? { x: 18, y: 18 } : undefined,
        // 不再显式传 `frame`：macOS 必须保留原生边框（默认 true）才能让
        // `titleBarStyle: 'hiddenInset'` 正确隐藏标题栏并保留交通灯按钮；
        // 一旦同时传 `frame: false`，Electron 会按「无边框窗口」处理，
        // 交通灯可能不显示或不再按 inset 位置排布，窗口将无法关闭/缩放。
        // Windows / Linux 同样使用原生边框（与此前 `frame: !isMac` 的取值一致）。
        // macOS 下允许点击非激活窗口内的控件，符合系统习惯。
        acceptFirstMouse: isMac,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: true,
        },
    });
    installContextMenu(window);
    // 导航锁定 + webview 策略：外链交系统浏览器，webview 强制无 node 集成。
    installNavigationLock(window);
    /**
     * macOS：进入全屏后系统会隐藏交通灯，顶部 34px 拖拽区与拖拽层不再需要。
     * 把全屏状态同步给渲染层，让各页收回这段留白（见 `styles.css` 的 `[data-fullscreen]`）。
     */
    if (isMac) {
        const publishFullScreen = (fullScreen: boolean): void => {
            if (!window.isDestroyed()) window.webContents.send('cees:window-fullscreen-changed', fullScreen);
        };
        window.on('enter-full-screen', () => publishFullScreen(true));
        window.on('leave-full-screen', () => publishFullScreen(false));
        window.webContents.on('did-finish-load', () => publishFullScreen(window.isFullScreen()));
    }
    window.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
        return { action: 'deny' };
    });
    if (!app.isPackaged) {
        window.webContents.once('did-finish-load', () => {
            window.webContents.openDevTools({ mode: 'detach', activate: true });
        });
        void window.loadURL(process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173');
    } else {
        void window.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

app.whenReady().then(() => {
    const dingtalkConnector = getDingTalkConnector();
    const userDataPath = app.getPath('userData');
    dingtalkConnector.configure(userDataPath);
    tencentMeetingConnector.configure(userDataPath);
    weComConnector.configure(userDataPath);
    githubConnector.configure(userDataPath);
    // 安全基线：IPC 来源校验必须最先安装，保证后续注册的所有通道都受保护。
    installIpcSenderGuard();
    installContentSecurityPolicy(session.defaultSession);
    const tokenStore = new SecureTokenStore(userDataPath);
    // macOS 保留系统菜单（⇆Q / ⇆C 等）；Windows / Linux 置空——判断内聚在 installApplicationMenu。
    installApplicationMenu();
    ipcMain.handle('cees:secure-store-get-all', () => tokenStore.getAll());
    ipcMain.handle('cees:secure-store-set', (_event, key: unknown, value: unknown) => {
        if (typeof key !== 'string' || typeof value !== 'string') throw new Error('安全存储参数无效');
        return tokenStore.set(key, value);
    });
    ipcMain.handle('cees:secure-store-remove', (_event, key: unknown) => {
        if (typeof key !== 'string') throw new Error('安全存储参数无效');
        return tokenStore.remove(key);
    });
    ipcMain.on('cees:open-devtools', (event) => {
        BrowserWindow.fromWebContents(event.sender)?.webContents.openDevTools({ mode: 'detach', activate: true });
    });
    ipcMain.handle('cees:open-external', async (_event, value: unknown) => {
        if (typeof value !== 'string') throw new Error('外部链接无效');
        const url = new URL(value);
        if (url.protocol !== 'https:') throw new Error('仅允许打开 HTTPS 外部链接');
        await shell.openExternal(url.toString());
        return true;
    });
    ipcMain.handle('cees:connector-list', () => connectorHost.list());
    ipcMain.handle('cees:connector-status', (_event, connectorId: unknown) =>
        connectorHost.status(assertConnectorId(connectorId)));
    ipcMain.handle('cees:connector-connect', (_event, connectorId: unknown) =>
        connectorHost.connect(assertConnectorId(connectorId)));
    ipcMain.handle('cees:connector-disconnect', (_event, connectorId: unknown) =>
        connectorHost.disconnect(assertConnectorId(connectorId)));
    ipcMain.handle('cees:connector-tools', (_event, connectorId: unknown) =>
        connectorHost.tools(assertConnectorId(connectorId)));
    ipcMain.handle('cees:connector-execute', (_event, connectorId: unknown, calls: unknown) =>
        connectorHost.execute(assertConnectorId(connectorId), calls));
    ipcMain.handle('cees:dingtalk-dws-status', () => connectorHost.status('dingtalk'));
    ipcMain.handle('cees:dingtalk-dws-login', async () => {
        const status = await dingtalkConnector.login();
        dingtalkConnector.resetTools();
        connectorHost.publishStatus('dingtalk', status);
        return status;
    });
    ipcMain.handle('cees:dingtalk-dws-select-profile', async (_event, profile: unknown) => {
        if (typeof profile !== 'string') throw new Error('钉钉组织账号选择无效');
        const status = await dingtalkConnector.selectProfile(profile);
        dingtalkConnector.resetTools();
        connectorHost.publishStatus('dingtalk', status);
        return status;
    });
    ipcMain.handle('cees:dingtalk-dws-fetch-organization', async () => {
        try {
            return await dingtalkConnector.fetchOrganization();
        } catch (error) {
            await connectorHost.status('dingtalk');
            throw error;
        }
    });
    ipcMain.handle('cees:dingtalk-connector-status', () => connectorHost.status('dingtalk'));
    ipcMain.handle('cees:dingtalk-connector-connect', () => connectorHost.connect('dingtalk'));
    ipcMain.handle('cees:dingtalk-connector-disconnect', () => connectorHost.disconnect('dingtalk'));
    ipcMain.handle('cees:dingtalk-connector-tools', () => connectorHost.tools('dingtalk'));
    ipcMain.handle('cees:dingtalk-connector-execute', (_event, calls: unknown) =>
        connectorHost.execute('dingtalk', calls));
    ipcMain.handle('cees:dingtalk-connector-release', () => dingtalkConnector.getRelease());
    ipcMain.handle('cees:dingtalk-connector-update-check', () => dingtalkConnector.checkForUpdates());
    ipcMain.handle('cees:dingtalk-connector-upgrade', async (_event, targetVersion: unknown) => {
        if (targetVersion !== undefined && typeof targetVersion !== 'string') throw new Error('DWS 目标版本无效');
        try {
            const result = await dingtalkConnector.upgrade(targetVersion);
            connectorHost.publishStatus('dingtalk', result.status);
            return result.release;
        } catch (error) {
            await connectorHost.status('dingtalk');
            throw error;
        }
    });
    ipcMain.handle('cees:dingtalk-connector-rollback', async () => {
        try {
            const result = await dingtalkConnector.rollback();
            connectorHost.publishStatus('dingtalk', result.status);
            return result.release;
        } catch (error) {
            await connectorHost.status('dingtalk');
            throw error;
        }
    });
    createWindow();
    // macOS：窗口关闭后不退出应用，点击 Dock 图标需要重新创建窗口。
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

function assertConnectorId(value: unknown): string {
    if (typeof value !== 'string') throw new Error('连接器 ID 无效');
    return value;
}

// TODO: Add a signed auto-update provider and staged rollout policy before production release.
