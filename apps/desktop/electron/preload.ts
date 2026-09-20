import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type { DingTalkDwsSnapshot, DingTalkDwsStatus } from './dingtalk-dws';
import type { DingTalkConnectorContext, DingTalkConnectorPlannedCall, DingTalkConnectorTool } from './dingtalk-connector';

contextBridge.exposeInMainWorld('cees', {
    platform: process.platform,
    version: process.versions.electron,
    setZoomFactor: (factor: number) => webFrame.setZoomFactor(factor),
    openDevTools: () => ipcRenderer.send('cees:open-devtools'),
    dingtalkDws: {
        status: (): Promise<DingTalkDwsStatus> => ipcRenderer.invoke('cees:dingtalk-dws-status'),
        login: (): Promise<DingTalkDwsStatus> => ipcRenderer.invoke('cees:dingtalk-dws-login'),
        fetchOrganization: (): Promise<DingTalkDwsSnapshot> => ipcRenderer.invoke('cees:dingtalk-dws-fetch-organization'),
    },
    connectors: {
        dingtalk: {
            status: (): Promise<DingTalkDwsStatus> => ipcRenderer.invoke('cees:dingtalk-connector-status'),
            connect: (): Promise<DingTalkDwsStatus> => ipcRenderer.invoke('cees:dingtalk-connector-connect'),
            tools: (): Promise<DingTalkConnectorTool[]> => ipcRenderer.invoke('cees:dingtalk-connector-tools'),
            execute: (calls: DingTalkConnectorPlannedCall[]): Promise<DingTalkConnectorContext[]> => ipcRenderer.invoke('cees:dingtalk-connector-execute', calls),
            release: (): Promise<{ version: string; license: string }> => ipcRenderer.invoke('cees:dingtalk-connector-release'),
        },
    },
});
