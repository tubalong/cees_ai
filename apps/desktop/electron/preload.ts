import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type { ConnectorStatusChangedEvent } from './connectors/core/connector-host';
import type {
    ConnectorContext,
    ConnectorManifest,
    ConnectorPlannedCall,
    ConnectorStatus,
    ConnectorTool,
} from './connectors/core/connector.types';
import type { DingTalkDwsSnapshot, DingTalkDwsStatus } from './dingtalk-dws';
import type { DingTalkConnectorContext, DingTalkConnectorPlannedCall, DingTalkConnectorReleaseStatus, DingTalkConnectorTool } from './dingtalk-connector';

contextBridge.exposeInMainWorld('cees', {
    platform: process.platform,
    version: process.versions.electron,
    setZoomFactor: (factor: number) => webFrame.setZoomFactor(factor),
    openDevTools: () => ipcRenderer.send('cees:open-devtools'),
    openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('cees:open-external', url),
    localSystem: {
        scanVolumes: (): Promise<import('./local-tools/disk-scanner').VolumeSummary[]> =>
            ipcRenderer.invoke('cees:local-disk-scan-volumes'),
        chooseAndScanDirectory: (): Promise<import('./local-tools/disk-scanner').DirectorySizeSummary | null> =>
            ipcRenderer.invoke('cees:local-disk-choose-and-scan-directory'),
        chooseAndQuarantine: (selectionKind: 'files' | 'directory'): Promise<import('./local-tools/cleanup-manager').PublicCleanupJob | null> =>
            ipcRenderer.invoke('cees:local-cleanup-choose-and-quarantine', selectionKind),
        restoreLatest: (): Promise<import('./local-tools/cleanup-manager').PublicCleanupJob> =>
            ipcRenderer.invoke('cees:local-cleanup-restore-latest'),
        cleanLatest: (): Promise<import('./local-tools/cleanup-manager').PublicCleanupJob> =>
            ipcRenderer.invoke('cees:local-cleanup-clean-latest'),
        /**
         * 把已生成的产物另存到本机。目标路径只能由主进程的系统保存对话框产生，
         * 渲染层只提供建议文件名、扩展名与字节。
         */
        saveGeneratedFile: (request: {
            suggestedName: string;
            extension: string;
            bytes: Uint8Array;
        }): Promise<import('./local-tools/file-saver').SaveGeneratedFileResult> =>
            ipcRenderer.invoke('cees:local-save-generated-file', request),
    },
    /**
     * 加密会话存储：令牌经主进程 safeStorage 加密后落盘，
     * 渲染层不再把刷新令牌写进 localStorage / sessionStorage。
     */
    secureStore: {
        getAll: (): Promise<Record<string, string>> => ipcRenderer.invoke('cees:secure-store-get-all'),
        set: (key: string, value: string): Promise<void> => ipcRenderer.invoke('cees:secure-store-set', key, value),
        remove: (key: string): Promise<void> => ipcRenderer.invoke('cees:secure-store-remove', key),
    },
    /** macOS 全屏/退出全屏通知：全屏时系统隐藏交通灯，渲染层需收回顶部拖拽留白。 */
    onFullScreenChanged: (listener: (fullScreen: boolean) => void): (() => void) => {
        const handler = (_event: Electron.IpcRendererEvent, fullScreen: boolean): void => listener(fullScreen);
        ipcRenderer.on('cees:window-fullscreen-changed', handler);
        return () => ipcRenderer.removeListener('cees:window-fullscreen-changed', handler);
    },
    dingtalkDws: {
        status: (): Promise<DingTalkDwsStatus> => ipcRenderer.invoke('cees:dingtalk-dws-status'),
        login: (): Promise<DingTalkDwsStatus> => ipcRenderer.invoke('cees:dingtalk-dws-login'),
        selectProfile: (profile: string): Promise<DingTalkDwsStatus> => ipcRenderer.invoke('cees:dingtalk-dws-select-profile', profile),
        fetchOrganization: (): Promise<DingTalkDwsSnapshot> => ipcRenderer.invoke('cees:dingtalk-dws-fetch-organization'),
    },
    connectors: {
        list: (): Promise<ConnectorManifest[]> => ipcRenderer.invoke('cees:connector-list'),
        status: (connectorId: string): Promise<ConnectorStatus> => ipcRenderer.invoke('cees:connector-status', connectorId),
        connect: (connectorId: string, options?: unknown): Promise<ConnectorStatus> => ipcRenderer.invoke('cees:connector-connect', connectorId, options),
        disconnect: (connectorId: string): Promise<ConnectorStatus> => ipcRenderer.invoke('cees:connector-disconnect', connectorId),
        tools: (connectorId: string): Promise<ConnectorTool[]> => ipcRenderer.invoke('cees:connector-tools', connectorId),
        execute: (connectorId: string, calls: ConnectorPlannedCall[]): Promise<ConnectorContext[]> =>
            ipcRenderer.invoke('cees:connector-execute', connectorId, calls),
        onStatusChanged: (listener: (event: ConnectorStatusChangedEvent) => void): (() => void) => {
            const handler = (_event: Electron.IpcRendererEvent, event: ConnectorStatusChangedEvent): void => listener(event);
            ipcRenderer.on('cees:connector-status-changed', handler);
            return () => ipcRenderer.removeListener('cees:connector-status-changed', handler);
        },
        dingtalk: {
            status: (): Promise<DingTalkDwsStatus> => ipcRenderer.invoke('cees:connector-status', 'dingtalk'),
            connect: (): Promise<DingTalkDwsStatus> => ipcRenderer.invoke('cees:connector-connect', 'dingtalk'),
            disconnect: (): Promise<DingTalkDwsStatus> => ipcRenderer.invoke('cees:connector-disconnect', 'dingtalk'),
            selectProfile: (profile: string): Promise<DingTalkDwsStatus> => ipcRenderer.invoke('cees:dingtalk-dws-select-profile', profile),
            tools: (): Promise<DingTalkConnectorTool[]> => ipcRenderer.invoke('cees:connector-tools', 'dingtalk'),
            execute: (calls: DingTalkConnectorPlannedCall[]): Promise<DingTalkConnectorContext[]> =>
                ipcRenderer.invoke('cees:connector-execute', 'dingtalk', calls),
            release: (): Promise<DingTalkConnectorReleaseStatus> => ipcRenderer.invoke('cees:dingtalk-connector-release'),
            checkForUpdates: (): Promise<DingTalkConnectorReleaseStatus> => ipcRenderer.invoke('cees:dingtalk-connector-update-check'),
            upgrade: (targetVersion?: string): Promise<DingTalkConnectorReleaseStatus> => ipcRenderer.invoke('cees:dingtalk-connector-upgrade', targetVersion),
            rollback: (): Promise<DingTalkConnectorReleaseStatus> => ipcRenderer.invoke('cees:dingtalk-connector-rollback'),
            onStatusChanged: (listener: (status: DingTalkDwsStatus) => void): (() => void) => {
                const handler = (_event: Electron.IpcRendererEvent, status: DingTalkDwsStatus): void => listener(status);
                ipcRenderer.on('cees:dingtalk-connector-status-changed', handler);
                return () => ipcRenderer.removeListener('cees:dingtalk-connector-status-changed', handler);
            },
        },
    },
});
