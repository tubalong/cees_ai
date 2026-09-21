import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type { DingTalkDwsSnapshot, DingTalkDwsStatus } from './dingtalk-dws';
import type { DingTalkConnectorContext, DingTalkConnectorPlannedCall, DingTalkConnectorReleaseStatus, DingTalkConnectorTool } from './dingtalk-connector';

contextBridge.exposeInMainWorld('cees', {
    platform: process.platform,
    version: process.versions.electron,
    setZoomFactor: (factor: number) => webFrame.setZoomFactor(factor),
    openDevTools: () => ipcRenderer.send('cees:open-devtools'),
    dingtalkDws: {
        status: (): Promise<DingTalkDwsStatus> => ipcRenderer.invoke('cees:dingtalk-dws-status'),
        login: (): Promise<DingTalkDwsStatus> => ipcRenderer.invoke('cees:dingtalk-dws-login'),
        selectProfile: (profile: string): Promise<DingTalkDwsStatus> => ipcRenderer.invoke('cees:dingtalk-dws-select-profile', profile),
        fetchOrganization: (): Promise<DingTalkDwsSnapshot> => ipcRenderer.invoke('cees:dingtalk-dws-fetch-organization'),
    },
    connectors: {
        dingtalk: {
            status: (): Promise<DingTalkDwsStatus> => ipcRenderer.invoke('cees:dingtalk-connector-status'),
            connect: (): Promise<DingTalkDwsStatus> => ipcRenderer.invoke('cees:dingtalk-connector-connect'),
            selectProfile: (profile: string): Promise<DingTalkDwsStatus> => ipcRenderer.invoke('cees:dingtalk-dws-select-profile', profile),
            tools: (): Promise<DingTalkConnectorTool[]> => ipcRenderer.invoke('cees:dingtalk-connector-tools'),
            execute: (calls: DingTalkConnectorPlannedCall[]): Promise<DingTalkConnectorContext[]> => ipcRenderer.invoke('cees:dingtalk-connector-execute', calls),
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
