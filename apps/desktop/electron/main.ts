import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import { ConnectorRegistry } from './connectors/core/connector-registry';
import { DingTalkConnectorAdapter } from './connectors/dingtalk/dingtalk.adapter';
import type { DingTalkDwsStatus } from './dingtalk-dws';

const connectorRegistry = new ConnectorRegistry();
connectorRegistry.register(new DingTalkConnectorAdapter());

function getDingTalkConnector(): DingTalkConnectorAdapter {
    return connectorRegistry.get<DingTalkConnectorAdapter>('dingtalk');
}

function publishDingTalkStatus(status: DingTalkDwsStatus): void {
    for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('cees:dingtalk-connector-status-changed', status);
    }
}

async function refreshDingTalkStatus(): Promise<DingTalkDwsStatus> {
    const connector = getDingTalkConnector();
    const status = await connector.status();
    if (status.state !== 'READY') connector.resetTools();
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
    const dingtalkConnector = getDingTalkConnector();
    dingtalkConnector.configure(app.getPath('userData'));
    Menu.setApplicationMenu(null);
    ipcMain.on('cees:open-devtools', (event) => {
        BrowserWindow.fromWebContents(event.sender)?.webContents.openDevTools({ mode: 'detach', activate: true });
    });
    ipcMain.handle('cees:dingtalk-dws-status', () => refreshDingTalkStatus());
    ipcMain.handle('cees:dingtalk-dws-login', async () => {
        const status = await dingtalkConnector.login();
        dingtalkConnector.resetTools();
        publishDingTalkStatus(status);
        return status;
    });
    ipcMain.handle('cees:dingtalk-dws-select-profile', async (_event, profile: unknown) => {
        if (typeof profile !== 'string') throw new Error('钉钉组织账号选择无效');
        const status = await dingtalkConnector.selectProfile(profile);
        dingtalkConnector.resetTools();
        publishDingTalkStatus(status);
        return status;
    });
    ipcMain.handle('cees:dingtalk-dws-fetch-organization', async () => {
        try {
            return await dingtalkConnector.fetchOrganization();
        } catch (error) {
            await refreshDingTalkStatus();
            throw error;
        }
    });
    ipcMain.handle('cees:dingtalk-connector-status', () => refreshDingTalkStatus());
    ipcMain.handle('cees:dingtalk-connector-connect', async () => {
        const status = await dingtalkConnector.connect();
        publishDingTalkStatus(status);
        return status;
    });
    ipcMain.handle('cees:dingtalk-connector-disconnect', async () => {
        try {
            const status = await dingtalkConnector.disconnect();
            dingtalkConnector.resetTools();
            publishDingTalkStatus(status);
            return status;
        } catch (error) {
            await refreshDingTalkStatus();
            throw error;
        }
    });
    ipcMain.handle('cees:dingtalk-connector-tools', async () => {
        try {
            return await dingtalkConnector.discoverTools();
        } catch (error) {
            await refreshDingTalkStatus();
            throw error;
        }
    });
    ipcMain.handle('cees:dingtalk-connector-execute', async (_event, calls: unknown) => {
        if (!Array.isArray(calls) || calls.length > 3) throw new Error('钉钉连接器调用计划无效');
        try {
            return await dingtalkConnector.execute(calls as never);
        } catch (error) {
            dingtalkConnector.resetTools();
            await refreshDingTalkStatus();
            throw error;
        }
    });
    ipcMain.handle('cees:dingtalk-connector-release', () => dingtalkConnector.getRelease());
    ipcMain.handle('cees:dingtalk-connector-update-check', () => dingtalkConnector.checkForUpdates());
    ipcMain.handle('cees:dingtalk-connector-upgrade', async (_event, targetVersion: unknown) => {
        if (targetVersion !== undefined && typeof targetVersion !== 'string') throw new Error('DWS 目标版本无效');
        try {
            const result = await dingtalkConnector.upgrade(targetVersion);
            publishDingTalkStatus(result.status);
            return result.release;
        } catch (error) {
            await refreshDingTalkStatus();
            throw error;
        }
    });
    ipcMain.handle('cees:dingtalk-connector-rollback', async () => {
        try {
            const result = await dingtalkConnector.rollback();
            publishDingTalkStatus(result.status);
            return result.release;
        } catch (error) {
            await refreshDingTalkStatus();
            throw error;
        }
    });
    createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// TODO: Add a signed auto-update provider and staged rollout policy before production release.
