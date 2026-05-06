import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('webclawDesktop', {
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  selectProvider: (provider: string) => ipcRenderer.invoke('browser:selectProvider', provider),
  reloadCurrentProvider: () => ipcRenderer.invoke('browser:reloadCurrent'),
  reloadAllProviders: () => ipcRenderer.invoke('browser:reloadAllProviders'),
  openBrowserDevTools: () => ipcRenderer.invoke('browser:openDevTools'),
  showBrowserWaiting: () => ipcRenderer.invoke('browser:showWaiting'),
  showBrowserMonitor: (url: string) => ipcRenderer.invoke('browser:showMonitor', { url }),
  resetBrowser: () => ipcRenderer.invoke('browser:reset'),
  setBrowserBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('browser:setBounds', bounds),
  setBrowserSplitRatio: (ratio: number) => ipcRenderer.invoke('browser:setSplitRatio', ratio),
  navigateBrowser: (url: string) => ipcRenderer.invoke('browser:navigate', url),
  setTheme: (theme: 'dark' | 'light') => ipcRenderer.invoke('desktop:setTheme', theme),
  getDesktopState: () => ipcRenderer.invoke('desktop:getState'),
  updateProviderConfig: (payload: { provider: string; models?: string[]; defaultMode?: 'web' | 'forward'; inputMaxChars?: number | null; forwardBaseUrl?: string; apiKey?: string }) =>
    ipcRenderer.invoke('provider:updateConfig', payload),
  updateSettings: (payload: { servicePort: number }) =>
    ipcRenderer.invoke('settings:update', payload),
  updatePromptConfig: (payload: { init_prompt: string; init_prompt_template: string; user_message_template: string; response_schema_template: string; format_only_retry_template: string }) =>
    ipcRenderer.invoke('prompt:update', payload),
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
  /** 执行工具（通过 IPC 在主进程 Node.js 环境中执行） */
  executeTool: (toolName: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke('tool:execute', { toolName, args }),
});
