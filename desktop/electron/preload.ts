import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('webclawDesktop', {
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
});
