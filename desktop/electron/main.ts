import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { BrowserViewManager } from './browser-view-manager';
import type { ProviderKey } from './provider-sites';
import { ServiceManager } from './service-manager';
import { ShellTerminalManager } from './shell-terminal-manager';

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const APP_DATA_ROOT = path.join(process.cwd(), '.electron-data');
const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const CDP_URL = 'http://127.0.0.1:9222';
const CDP_PORT = '9222';

let browserViewManager: BrowserViewManager | null = null;
let serviceManager: ServiceManager | null = null;
let shellTerminalManager: ShellTerminalManager | null = null;
let providerSites: Record<ProviderKey, string> = {} as Record<ProviderKey, string>;
let providerModels: Record<ProviderKey, string[]> = {} as Record<ProviderKey, string[]>;
let providerDefaultModes: Record<ProviderKey, 'web' | 'forward'> = {} as Record<ProviderKey, 'web' | 'forward'>;
let isAppShuttingDown = false;
let mainWindowRef: BrowserWindow | null = null;

fs.mkdirSync(APP_DATA_ROOT, { recursive: true });
fs.mkdirSync(path.join(APP_DATA_ROOT, 'user-data'), { recursive: true });
fs.mkdirSync(path.join(APP_DATA_ROOT, 'session-data'), { recursive: true });
fs.mkdirSync(path.join(APP_DATA_ROOT, 'cache'), { recursive: true });

app.setPath('userData', path.join(APP_DATA_ROOT, 'user-data'));
app.setPath('sessionData', path.join(APP_DATA_ROOT, 'session-data'));
app.setPath('cache', path.join(APP_DATA_ROOT, 'cache'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('remote-debugging-port', CDP_PORT);

function getApiBaseUrl(): string {
  return 'http://127.0.0.1:3000';
}

type ProviderCatalogPayload = {
  providers?: Record<string, { models?: string[]; default_mode?: 'web' | 'forward'; site?: string }>;
};

async function refreshProviderCatalogFromService(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${getApiBaseUrl()}/v1/providers`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as ProviderCatalogPayload;
    const map = payload.providers ?? {};
    const nextSites = {} as Record<ProviderKey, string>;
    const nextModels = {} as Record<ProviderKey, string[]>;
    const nextModes = {} as Record<ProviderKey, 'web' | 'forward'>;
    for (const key of ['gpt', 'qwen', 'deepseek', 'kimi', 'glm', 'claude', 'doubao'] as ProviderKey[]) {
      const item = map[key];
      nextSites[key] = typeof item?.site === 'string' ? item.site : '';
      nextModels[key] = Array.isArray(item?.models) ? item!.models! : [];
      nextModes[key] = item?.default_mode === 'forward' ? 'forward' : 'web';
    }
    providerSites = nextSites;
    providerModels = nextModels;
    providerDefaultModes = nextModes;
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureBrowserViewManager(window: BrowserWindow): Promise<void> {
  const siteEntries = Object.entries(providerSites).filter(([, site]) => typeof site === 'string' && site.trim().length > 0) as [ProviderKey, string][];
  const compactSites = Object.fromEntries(siteEntries) as Record<ProviderKey, string>;
  if (!browserViewManager) {
    browserViewManager = new BrowserViewManager({ providerSites: compactSites });
    const initialProvider = siteEntries[0]?.[0] ?? null;
    await browserViewManager.attach(window, initialProvider);
    return;
  }
  await browserViewManager.syncProviderSites(compactSites);
  const currentProvider = browserViewManager.getCurrentProvider();
  if (currentProvider && browserViewManager.hasProviderView(currentProvider)) {
    browserViewManager.showProvider(currentProvider);
    return;
  }
  const initialProvider = siteEntries[0]?.[0];
  if (initialProvider) {
    browserViewManager.showProvider(initialProvider);
  } else {
    browserViewManager.showWaiting();
  }
}

async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#0f172a',
    title: 'WebClaw Console',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (DEV_SERVER_URL) {
    void window.loadURL(DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }

  mainWindowRef = window;
  await refreshProviderCatalogFromService();
  await ensureBrowserViewManager(window);

  serviceManager = new ServiceManager(PROJECT_ROOT, 'electron-cdp', CDP_URL, window);
  shellTerminalManager = new ShellTerminalManager(PROJECT_ROOT, window);

  return window;
}

async function shutdownAppResources(): Promise<void> {
  await serviceManager?.stop();
}

app.whenReady().then(() => {
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (url) {
      await shell.openExternal(url);
    }
  });
  ipcMain.handle('browser:selectProvider', async (_event, provider: ProviderKey) => {
    if (!browserViewManager && mainWindowRef) {
      await refreshProviderCatalogFromService();
      await ensureBrowserViewManager(mainWindowRef);
    }
    browserViewManager?.showProvider(provider);
    return {
      provider,
      url: browserViewManager?.getCurrentUrl() ?? '',
    };
  });
  ipcMain.handle('browser:reloadCurrent', async () => {
    await browserViewManager?.reloadCurrentProvider();
    return { url: browserViewManager?.getCurrentUrl() ?? '' };
  });
  ipcMain.handle('browser:openDevTools', async () => {
    await browserViewManager?.openDevTools();
  });
  ipcMain.handle(
    'browser:setBounds',
    async (_event, bounds: { x: number; y: number; width: number; height: number }) => {
      browserViewManager?.setBounds(bounds);
    }
  );
  ipcMain.handle('browser:setSplitRatio', async (_event, ratio: number) => {
    browserViewManager?.setSplitRatio(ratio);
  });
  ipcMain.handle('browser:navigate', async (_event, url: string) => {
    await browserViewManager?.navigateTo(url);
  });
  ipcMain.handle('desktop:getState', async () => {
    if (serviceManager?.getStatus() === 'running') {
      await refreshProviderCatalogFromService();
      if (mainWindowRef) await ensureBrowserViewManager(mainWindowRef);
    }
    return {
      currentProvider: browserViewManager?.getCurrentProvider() ?? null,
      providerSites,
      providerModels,
      providerDefaultModes,
      currentUrl: browserViewManager?.getCurrentUrl() ?? '',
      serviceStatus: serviceManager?.getStatus() ?? 'stopped',
      apiBaseUrl: getApiBaseUrl(),
      cdpUrl: CDP_URL,
    };
  });
  ipcMain.handle('service:start', async () => {
    const status = await serviceManager?.start() ?? 'stopped';
    if (status === 'running') {
      await refreshProviderCatalogFromService();
      if (mainWindowRef) await ensureBrowserViewManager(mainWindowRef);
    }
    return { status };
  });
  ipcMain.handle('service:stop', async () => ({ status: await serviceManager?.stop() ?? 'stopped' }));
  ipcMain.handle('service:restart', async () => {
    const status = await serviceManager?.restart() ?? 'stopped';
    if (status === 'running') {
      await refreshProviderCatalogFromService();
      if (mainWindowRef) await ensureBrowserViewManager(mainWindowRef);
    }
    return { status };
  });
  ipcMain.handle('terminal:init', async () => await shellTerminalManager?.ensureDefaultStarted());
  ipcMain.handle('terminal:list', async () => ({ terminals: shellTerminalManager?.list() ?? [] }));
  ipcMain.handle('terminal:create', async (_event, options?: { shell?: string; cwd?: string }) => {
    return await shellTerminalManager?.create(options);
  });
  ipcMain.handle('terminal:close', async (_event, terminalId: string) => {
    return await shellTerminalManager?.close(terminalId);
  });
  ipcMain.handle('terminal:write', async (_event, terminalId: string, command: string) => {
    await shellTerminalManager?.write(terminalId, command);
  });
  ipcMain.handle('terminal:interrupt', async (_event, terminalId: string) => {
    await shellTerminalManager?.interrupt(terminalId);
  });
  ipcMain.handle('terminal:resize', async (_event, terminalId: string, cols: number, rows: number) => {
    await shellTerminalManager?.resize(terminalId, cols, rows);
  });

  void createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (isAppShuttingDown) {
    return;
  }

  isAppShuttingDown = true;
  event.preventDefault();

  void shutdownAppResources().finally(() => {
    app.quit();
  });
});
