import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';

export interface AppUpdateStatus {
    state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error';
    version: string | null;
    downloaded: boolean;
    error: string | null;
}

let status: AppUpdateStatus = { state: 'idle', version: null, downloaded: false, error: null };
let checkPromise: Promise<AppUpdateStatus> | undefined;
let promptVersion: string | undefined;

function publish(next: AppUpdateStatus): void {
    status = next;
    for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('cees:app-update-status', next);
    }
}

async function checkForUpdates(): Promise<AppUpdateStatus> {
    if (!app.isPackaged || process.platform === 'linux') return status;
    if (checkPromise) return checkPromise;
    checkPromise = (async () => {
        publish({ ...status, state: 'checking', error: null });
        try {
            await autoUpdater.checkForUpdates();
        } catch (error) {
            publish({ state: 'error', version: null, downloaded: false, error: error instanceof Error ? error.message : '检查更新失败' });
        }
        return status;
    })();
    try {
        return await checkPromise;
    } finally {
        checkPromise = undefined;
    }
}

async function downloadUpdate(): Promise<AppUpdateStatus> {
    if (!app.isPackaged || process.platform === 'linux') return status;
    publish({ ...status, state: 'downloading', error: null });
    try {
        await autoUpdater.downloadUpdate();
    } catch (error) {
        publish({ ...status, state: 'error', error: error instanceof Error ? error.message : '下载更新失败' });
    }
    return status;
}

function installDownloadedUpdate(): AppUpdateStatus {
    if (status.downloaded) autoUpdater.quitAndInstall(false, true);
    return status;
}

export function installAppUpdater(): void {
    ipcMain.handle('cees:app-update-status', () => status);
    ipcMain.handle('cees:app-update-check', () => checkForUpdates());
    ipcMain.handle('cees:app-update-download', () => downloadUpdate());
    ipcMain.handle('cees:app-update-install', () => installDownloadedUpdate());

    if (!app.isPackaged || process.platform === 'linux') return;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-not-available', (info) => {
        publish({ state: 'not-available', version: info.version, downloaded: false, error: null });
    });
    autoUpdater.on('update-available', async (info) => {
        publish({ state: 'available', version: info.version, downloaded: false, error: null });
        if (promptVersion === info.version) return;
        promptVersion = info.version;
        const result = await dialog.showMessageBox({
            type: 'info',
            title: 'CEES AI 有新版本',
            message: `发现新版本 ${info.version}`,
            detail: '可以在后台下载，下载完成后重启应用即可更新。',
            buttons: ['下载更新', '稍后'],
            defaultId: 0,
            cancelId: 1,
            noLink: true,
        });
        if (result.response === 0) await downloadUpdate();
    });
    autoUpdater.on('download-progress', () => {
        publish({ ...status, state: 'downloading', downloaded: false, error: null });
    });
    autoUpdater.on('update-downloaded', async (info) => {
        publish({ state: 'downloaded', version: info.version, downloaded: true, error: null });
        const result = await dialog.showMessageBox({
            type: 'info',
            title: 'CEES AI 更新已就绪',
            message: `版本 ${info.version} 已下载完成`,
            detail: '立即重启后会自动完成安装。',
            buttons: ['立即重启更新', '稍后'],
            defaultId: 0,
            cancelId: 1,
            noLink: true,
        });
        if (result.response === 0) installDownloadedUpdate();
    });
    autoUpdater.on('error', (error) => {
        publish({ ...status, state: 'error', error: error.message });
    });

    void checkForUpdates();
    setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000).unref();
}
