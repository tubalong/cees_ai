import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import {
    fetchDingTalkVisibleOrganization,
    getDingTalkDwsStatus,
    loginDingTalkDws,
    selectDingTalkDwsProfile,
} from './dingtalk-dws';
import {
    configureDingTalkConnector,
    getDingTalkConnectorRelease,
    installAndAuthorizeDingTalkConnector,
    discoverDingTalkReadTools,
    executeDingTalkReadCalls,
    resetDingTalkConnectorTools,
} from './dingtalk-connector';

function publishDingTalkStatus(status: Awaited<ReturnType<typeof getDingTalkDwsStatus>>): void {
    for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('cees:dingtalk-connector-status-changed', status);
    }
}

async function refreshDingTalkStatus(): Promise<Awaited<ReturnType<typeof getDingTalkDwsStatus>>> {
    const status = await getDingTalkDwsStatus();
    if (status.state !== 'READY') resetDingTalkConnectorTools();
    publishDingTalkStatus(status);
    return status;
}

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
    ipcMain.handle('cees:dingtalk-dws-status', () => refreshDingTalkStatus());
    ipcMain.handle('cees:dingtalk-dws-login', async () => {
        const status = await loginDingTalkDws();
        resetDingTalkConnectorTools();
        publishDingTalkStatus(status);
        return status;
    });
    ipcMain.handle('cees:dingtalk-dws-select-profile', async (_event, profile: unknown) => {
        if (typeof profile !== 'string') throw new Error('钉钉组织账号选择无效');
        const status = await selectDingTalkDwsProfile(profile);
        resetDingTalkConnectorTools();
        publishDingTalkStatus(status);
        return status;
    });
    ipcMain.handle('cees:dingtalk-dws-fetch-organization', async () => {
        try {
            return await fetchDingTalkVisibleOrganization();
        } catch (error) {
            await refreshDingTalkStatus();
            throw error;
        }
    });
    ipcMain.handle('cees:dingtalk-connector-status', () => refreshDingTalkStatus());
    ipcMain.handle('cees:dingtalk-connector-connect', async () => {
        const status = await installAndAuthorizeDingTalkConnector();
        publishDingTalkStatus(status);
        return status;
    });
    ipcMain.handle('cees:dingtalk-connector-tools', async () => {
        try {
            return await discoverDingTalkReadTools();
        } catch (error) {
            await refreshDingTalkStatus();
            throw error;
        }
    });
    ipcMain.handle('cees:dingtalk-connector-execute', async (_event, calls: unknown) => {
        if (!Array.isArray(calls) || calls.length > 3) throw new Error('钉钉连接器调用计划无效');
        try {
            return await executeDingTalkReadCalls(calls as never);
        } catch (error) {
            resetDingTalkConnectorTools();
            await refreshDingTalkStatus();
            throw error;
        }
    });
    ipcMain.handle('cees:dingtalk-connector-release', () => getDingTalkConnectorRelease());
    createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// TODO: Add a signed auto-update provider and staged rollout policy before production release.
