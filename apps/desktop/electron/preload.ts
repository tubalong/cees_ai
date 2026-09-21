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
    dingtalkDws: {
        status: (): Promise<DingTalkDwsStatus> => ipcRenderer.invoke('cees:dingtalk-dws-status'),
        login: (): Promise<DingTalkDwsStatus> => ipcRenderer.invoke('cees:dingtalk-dws-login'),
        selectProfile: (profile: string): Promise<DingTalkDwsStatus> => ipcRenderer.invoke('cees:dingtalk-dws-select-profile', profile),
        fetchOrganization: (): Promise<DingTalkDwsSnapshot> => ipcRenderer.invoke('cees:dingtalk-dws-fetch-organization'),
    },
    connectors: {
        list: (): Promise<ConnectorManifest[]> => ipcRenderer.invoke('cees:connector-list'),
        status: (connectorId: string): Promise<ConnectorStatus> => ipcRenderer.invoke('cees:connector-status', connectorId),
        connect: (connectorId: string): Promise<ConnectorStatus> => ipcRenderer.invoke('cees:connector-connect', connectorId),
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
