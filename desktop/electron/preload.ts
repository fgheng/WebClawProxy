import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('webclawDesktop', {
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  selectProvider: (provider: string) => ipcRenderer.invoke('browser:selectProvider', provider),
  reloadCurrentProvider: () => ipcRenderer.invoke('browser:reloadCurrent'),
  openBrowserDevTools: () => ipcRenderer.invoke('browser:openDevTools'),
  getDesktopState: () => ipcRenderer.invoke('desktop:getState'),
  startService: () => ipcRenderer.invoke('service:start'),
  stopService: () => ipcRenderer.invoke('service:stop'),
  restartService: () => ipcRenderer.invoke('service:restart'),
  onServiceLog: (callback: (event: { stream: 'stdout' | 'stderr'; message: string; timestamp: number }) => void) => {
    const listener = (_event: unknown, payload: { stream: 'stdout' | 'stderr'; message: string; timestamp: number }) => {
      callback(payload);
    };
    ipcRenderer.on('service:log', listener);
    return () => ipcRenderer.removeListener('service:log', listener);
  },
  onServiceStatus: (callback: (event: { status: string; timestamp: number }) => void) => {
    const listener = (_event: unknown, payload: { status: string; timestamp: number }) => {
      callback(payload);
    };
    ipcRenderer.on('service:status', listener);
    return () => ipcRenderer.removeListener('service:status', listener);
  },
});
