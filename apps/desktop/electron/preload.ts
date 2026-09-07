import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('cees', {
    platform: process.platform,
    version: process.versions.electron,
});
