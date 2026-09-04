import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('workbench', {
    platform: process.platform,
    version: process.versions.electron,
});