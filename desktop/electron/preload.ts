import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('webclawDesktop', {
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  selectProvider: (provider: string) => ipcRenderer.invoke('browser:selectProvider', provider),
  reloadCurrentProvider: () => ipcRenderer.invoke('browser:reloadCurrent'),
  openBrowserDevTools: () => ipcRenderer.invoke('browser:openDevTools'),
  setBrowserBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('browser:setBounds', bounds),
  setBrowserSplitRatio: (ratio: number) => ipcRenderer.invoke('browser:setSplitRatio', ratio),
  navigateBrowser: (url: string) => ipcRenderer.invoke('browser:navigate', url),
  getDesktopState: () => ipcRenderer.invoke('desktop:getState'),
  startService: () => ipcRenderer.invoke('service:start'),
  stopService: () => ipcRenderer.invoke('service:stop'),
  restartService: () => ipcRenderer.invoke('service:restart'),
  initTerminal: () => ipcRenderer.invoke('terminal:init'),
  listTerminals: () => ipcRenderer.invoke('terminal:list'),
  createTerminal: (options?: { shell?: string; cwd?: string }) => ipcRenderer.invoke('terminal:create', options),
  closeTerminal: (terminalId: string) => ipcRenderer.invoke('terminal:close', terminalId),
  writeTerminal: (terminalId: string, command: string) => ipcRenderer.invoke('terminal:write', terminalId, command),
  interruptTerminal: (terminalId: string) => ipcRenderer.invoke('terminal:interrupt', terminalId),
  resizeTerminal: (terminalId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('terminal:resize', terminalId, cols, rows),
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
  onServiceError: (callback: (event: { message: string; timestamp: number }) => void) => {
    const listener = (_event: unknown, payload: { message: string; timestamp: number }) => {
      callback(payload);
    };
    ipcRenderer.on('service:error', listener);
    return () => ipcRenderer.removeListener('service:error', listener);
  },
  onTerminalOutput: (
    callback: (event: { terminalId: string; stream: 'stdout' | 'system'; message: string; timestamp: number }) => void
  ) => {
    const listener = (
      _event: unknown,
      payload: { terminalId: string; stream: 'stdout' | 'system'; message: string; timestamp: number }
    ) => {
      callback(payload);
    };
    ipcRenderer.on('terminal:output', listener);
    return () => ipcRenderer.removeListener('terminal:output', listener);
  },
  onTerminalStatus: (
    callback: (event: { terminalId: string; status: string; backend: 'pty' | 'raw' | null; timestamp: number; shell: string; cwd: string; pid: number | null }) => void
  ) => {
    const listener = (
      _event: unknown,
      payload: { terminalId: string; status: string; backend: 'pty' | 'raw' | null; timestamp: number; shell: string; cwd: string; pid: number | null }
    ) => {
      callback(payload);
    };
    ipcRenderer.on('terminal:status', listener);
    return () => ipcRenderer.removeListener('terminal:status', listener);
  },
});
