"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('webclawDesktop', {
    openExternal: (url) => electron_1.ipcRenderer.invoke('shell:openExternal', url),
    selectProvider: (provider) => electron_1.ipcRenderer.invoke('browser:selectProvider', provider),
    reloadCurrentProvider: () => electron_1.ipcRenderer.invoke('browser:reloadCurrent'),
    openBrowserDevTools: () => electron_1.ipcRenderer.invoke('browser:openDevTools'),
    setBrowserBounds: (bounds) => electron_1.ipcRenderer.invoke('browser:setBounds', bounds),
    setBrowserSplitRatio: (ratio) => electron_1.ipcRenderer.invoke('browser:setSplitRatio', ratio),
    getDesktopState: () => electron_1.ipcRenderer.invoke('desktop:getState'),
    startService: () => electron_1.ipcRenderer.invoke('service:start'),
    stopService: () => electron_1.ipcRenderer.invoke('service:stop'),
    restartService: () => electron_1.ipcRenderer.invoke('service:restart'),
    initTerminal: () => electron_1.ipcRenderer.invoke('terminal:init'),
    writeTerminal: (command) => electron_1.ipcRenderer.invoke('terminal:write', command),
    interruptTerminal: () => electron_1.ipcRenderer.invoke('terminal:interrupt'),
    resizeTerminal: (cols, rows) => electron_1.ipcRenderer.invoke('terminal:resize', cols, rows),
    onServiceLog: (callback) => {
        const listener = (_event, payload) => {
            callback(payload);
        };
        electron_1.ipcRenderer.on('service:log', listener);
        return () => electron_1.ipcRenderer.removeListener('service:log', listener);
    },
    onServiceStatus: (callback) => {
        const listener = (_event, payload) => {
            callback(payload);
        };
        electron_1.ipcRenderer.on('service:status', listener);
        return () => electron_1.ipcRenderer.removeListener('service:status', listener);
    },
    onServiceError: (callback) => {
        const listener = (_event, payload) => {
            callback(payload);
        };
        electron_1.ipcRenderer.on('service:error', listener);
        return () => electron_1.ipcRenderer.removeListener('service:error', listener);
    },
    onTerminalOutput: (callback) => {
        const listener = (_event, payload) => {
            callback(payload);
        };
        electron_1.ipcRenderer.on('terminal:output', listener);
        return () => electron_1.ipcRenderer.removeListener('terminal:output', listener);
    },
    onTerminalStatus: (callback) => {
        const listener = (_event, payload) => {
            callback(payload);
        };
        electron_1.ipcRenderer.on('terminal:status', listener);
        return () => electron_1.ipcRenderer.removeListener('terminal:status', listener);
    },
});
