import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import {
    fetchDingTalkVisibleOrganization,
    getDingTalkDwsStatus,
    loginDingTalkDws,
} from './dingtalk-dws';
import {
    configureDingTalkConnector,
    getDingTalkConnectorRelease,
    installAndAuthorizeDingTalkConnector,
    discoverDingTalkReadTools,
    executeDingTalkReadCalls,
} from './dingtalk-connector';

function createWindow(): void {
    const window = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1100,
        minHeight: 720,
        backgroundColor: '#f4f6f8',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: true,
        },
    });
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
    configureDingTalkConnector(app.getPath('userData'));
    Menu.setApplicationMenu(null);
    ipcMain.on('cees:open-devtools', (event) => {
        BrowserWindow.fromWebContents(event.sender)?.webContents.openDevTools({ mode: 'detach', activate: true });
    });
    ipcMain.handle('cees:dingtalk-dws-status', () => getDingTalkDwsStatus());
    ipcMain.handle('cees:dingtalk-dws-login', () => loginDingTalkDws());
    ipcMain.handle('cees:dingtalk-dws-fetch-organization', () => fetchDingTalkVisibleOrganization());
    ipcMain.handle('cees:dingtalk-connector-status', () => getDingTalkDwsStatus());
    ipcMain.handle('cees:dingtalk-connector-connect', () => installAndAuthorizeDingTalkConnector());
    ipcMain.handle('cees:dingtalk-connector-tools', () => discoverDingTalkReadTools());
    ipcMain.handle('cees:dingtalk-connector-execute', (_event, calls: unknown) => {
        if (!Array.isArray(calls) || calls.length > 3) throw new Error('钉钉连接器调用计划无效');
        return executeDingTalkReadCalls(calls as never);
    });
    ipcMain.handle('cees:dingtalk-connector-release', () => getDingTalkConnectorRelease());
    createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// TODO: Add a signed auto-update provider and staged rollout policy before production release.
