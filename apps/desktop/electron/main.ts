import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import {
    ConnectorHost,
    type ConnectorStatusChangedEvent,
} from './connectors/core/connector-host';
import { ConnectorRegistry } from './connectors/core/connector-registry';
import { DingTalkConnectorAdapter } from './connectors/dingtalk/dingtalk.adapter';
import { TencentMeetingConnectorAdapter } from './connectors/tencent-meeting/tencent-meeting.adapter';

const connectorRegistry = new ConnectorRegistry();
const dingtalkConnector = new DingTalkConnectorAdapter();
const tencentMeetingConnector = new TencentMeetingConnectorAdapter();
connectorRegistry.register(dingtalkConnector);
connectorRegistry.register(tencentMeetingConnector);
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
    const userDataPath = app.getPath('userData');
    dingtalkConnector.configure(userDataPath);
    tencentMeetingConnector.configure(userDataPath);
    Menu.setApplicationMenu(null);
    ipcMain.on('cees:open-devtools', (event) => {
        BrowserWindow.fromWebContents(event.sender)?.webContents.openDevTools({ mode: 'detach', activate: true });
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
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

function assertConnectorId(value: unknown): string {
    if (typeof value !== 'string') throw new Error('连接器 ID 无效');
    return value;
}

// TODO: Add a signed auto-update provider and staged rollout policy before production release.
