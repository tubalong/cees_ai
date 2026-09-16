"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('cees', {
    platform: process.platform,
    version: process.versions.electron,
    setZoomFactor: (factor) => electron_1.webFrame.setZoomFactor(factor),
    openDevTools: () => electron_1.ipcRenderer.send('cees:open-devtools'),
});
