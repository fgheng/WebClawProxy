import { app, BrowserWindow, ipcMain, shell, nativeTheme } from 'electron';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { BrowserViewManager } from './browser-view-manager';
import type { ProviderKey } from './provider-sites';
import { ServiceManager } from './service-manager';
import { ShellTerminalManager } from './shell-terminal-manager';

const execFileAsync = promisify(execFile);

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const APP_DATA_ROOT = path.join(process.cwd(), '.electron-data');
const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const CDP_URL = 'http://127.0.0.1:9222';
const CDP_PORT = '9222';
const DEFAULT_SPLIT_RATIO = 0.56;
const SPLIT_DIVIDER_HEIGHT = 8;
const BOTTOM_ACTION_BAR_HEIGHT = 24;

let browserViewManager: BrowserViewManager | null = null;
let serviceManager: ServiceManager | null = null;
let shellTerminalManager: ShellTerminalManager | null = null;
let providerSites: Record<ProviderKey, string> = {} as Record<ProviderKey, string>;
let providerModels: Record<ProviderKey, string[]> = {} as Record<ProviderKey, string[]>;
let providerDefaultModes: Record<ProviderKey, 'web' | 'forward'> = {} as Record<ProviderKey, 'web' | 'forward'>;
let providerInputMaxChars: Record<ProviderKey, number | null> = {} as Record<ProviderKey, number | null>;
let providerForwardBaseUrls: Record<ProviderKey, string> = {} as Record<ProviderKey, string>;
let providerApiKeyMasked: Record<ProviderKey, string> = {} as Record<ProviderKey, string>;
let providerApiKeys: Record<ProviderKey, string> = {} as Record<ProviderKey, string>;
let isAppShuttingDown = false;
let mainWindowRef: BrowserWindow | null = null;
let configuredServicePort = 3000;
let runtimeServicePort = 3000;
let lastBrowserBounds: { x: number; y: number; width: number; height: number } | null = null;
let lastSplitRatio = DEFAULT_SPLIT_RATIO;
let desktopTheme: 'dark' | 'light' = 'dark';
let promptConfig: {
  init_prompt: string;
  init_prompt_template: string;
  user_message_template: string;
  response_schema_template: string;
  format_only_retry_template: string;
} = {
  init_prompt: '',
  init_prompt_template: '',
  user_message_template: '',
  response_schema_template: '',
  format_only_retry_template: '',
};

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

function readConfiguredServicePortFromFile(): number {
  try {
    const configPath = path.join(PROJECT_ROOT, 'config', 'default.json');
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { server?: { port?: unknown } };
    const value = Number(raw?.server?.port);
    if (Number.isInteger(value) && value > 0 && value <= 65535) {
      return value;
    }
  } catch {
    // ignore
  }
  return 3000;
}

function readPromptConfigFromFile(): {
  init_prompt: string;
  init_prompt_template: string;
  user_message_template: string;
  response_schema_template: string;
  format_only_retry_template: string;
} {
  try {
    const configPath = path.join(PROJECT_ROOT, 'config', 'default.json');
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, any>;
    const source = (raw.prompt ?? raw.defaults ?? {}) as Record<string, any>;
    return {
      init_prompt: typeof source.init_prompt === 'string' ? source.init_prompt : '',
      init_prompt_template: typeof source.init_prompt_template === 'string' ? source.init_prompt_template : '',
      user_message_template: typeof source.user_message_template === 'string' ? source.user_message_template : '',
      response_schema_template: typeof source.response_schema_template === 'string' ? source.response_schema_template : '',
      format_only_retry_template: typeof source.format_only_retry_template === 'string' ? source.format_only_retry_template : '',
    };
  } catch {
    return {
      init_prompt: '',
      init_prompt_template: '',
      user_message_template: '',
      response_schema_template: '',
      format_only_retry_template: '',
    };
  }
}

function getApiBaseUrl(): string {
  return `http://127.0.0.1:${runtimeServicePort}`;
}

async function probeServiceHealth(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function forceKillPortListeners(port: number): Promise<void> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return;
  let stdout = '';
  try {
    const res = await execFileAsync('lsof', ['-nP', '-i', `TCP:${port}`, '-sTCP:LISTEN', '-t'], { timeout: 1500 });
    stdout = String(res.stdout ?? '');
  } catch {
    return;
  }

  const pids = Array.from(
    new Set(
      stdout
        .split(/\r?\n/)
        .map((line) => Number(line.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
    )
  );
  if (pids.length === 0) return;

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // ignore
    }
  }
  await new Promise((r) => setTimeout(r, 600));
  for (const pid of pids) {
    try {
      process.kill(pid, 0);
    } catch {
      continue;
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }
}

type ProviderCatalogPayload = {
  providers?: Record<string, {
    models?: string[];
    default_mode?: 'web' | 'forward';
    site?: string;
    input_max_chars?: number | null;
    forward_base_url?: string;
    api_key?: string;
    api_key_masked?: string;
  }>;
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
    if (Object.keys(map).length === 0) return false;
    const nextSites = {} as Record<ProviderKey, string>;
    const nextModels = {} as Record<ProviderKey, string[]>;
    const nextModes = {} as Record<ProviderKey, 'web' | 'forward'>;
    const nextMaxChars = {} as Record<ProviderKey, number | null>;
    const nextBaseUrls = {} as Record<ProviderKey, string>;
    const nextApiKeys = {} as Record<ProviderKey, string>;
    const nextApiMasked = {} as Record<ProviderKey, string>;
    for (const key of ['gpt', 'qwen', 'deepseek', 'kimi', 'glm', 'claude', 'doubao'] as ProviderKey[]) {
      const item = map[key];
      nextSites[key] = typeof item?.site === 'string' ? item.site : '';
      nextModels[key] = Array.isArray(item?.models) ? item!.models! : [];
      nextModes[key] = item?.default_mode === 'forward' ? 'forward' : 'web';
      nextMaxChars[key] = typeof item?.input_max_chars === 'number' ? item.input_max_chars : null;
      nextBaseUrls[key] = typeof item?.forward_base_url === 'string' ? item.forward_base_url : '';
      nextApiKeys[key] = typeof item?.api_key === 'string' ? item.api_key : '';
      nextApiMasked[key] = typeof item?.api_key_masked === 'string' ? item.api_key_masked : '';
    }
    const hasAnySite = Object.values(nextSites).some((site) => typeof site === 'string' && site.trim().length > 0);
    if (!hasAnySite) return false;
    providerSites = nextSites;
    providerModels = nextModels;
    providerDefaultModes = nextModes;
    providerInputMaxChars = nextMaxChars;
    providerForwardBaseUrls = nextBaseUrls;
    providerApiKeys = nextApiKeys;
    providerApiKeyMasked = nextApiMasked;
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function clampBrowserBounds(bounds: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
  if (!mainWindowRef) return bounds;
  const [, windowHeight] = mainWindowRef.getContentSize();
  const splitHeight = Math.max(1, windowHeight - BOTTOM_ACTION_BAR_HEIGHT);
  const topRowHeight = Math.max(1, Math.floor((splitHeight - SPLIT_DIVIDER_HEIGHT) * lastSplitRatio));
  const maxBottomY = topRowHeight;
  const maxHeight = Math.max(1, Math.floor(maxBottomY - bounds.y));
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: Math.min(bounds.height, maxHeight),
  };
}

async function ensureBrowserViewManager(
  window: BrowserWindow,
  options?: { allowProviderViews?: boolean }
): Promise<void> {
  const siteEntries = Object.entries(providerSites).filter(([, site]) => typeof site === 'string' && site.trim().length > 0) as [ProviderKey, string][];
  const compactSites = (options?.allowProviderViews ?? true)
    ? (Object.fromEntries(siteEntries) as Record<ProviderKey, string>)
    : ({} as Record<ProviderKey, string>);
  if (!browserViewManager) {
    browserViewManager = new BrowserViewManager({ providerSites: compactSites, theme: desktopTheme });
    const initialProvider = (options?.allowProviderViews ?? true) ? (siteEntries[0]?.[0] ?? null) : null;
    await browserViewManager.attach(window, initialProvider);
    if (lastBrowserBounds) {
      browserViewManager.setBounds(clampBrowserBounds(lastBrowserBounds));
    }
    return;
  }
  await browserViewManager.syncProviderSites(compactSites);
  const currentProvider = browserViewManager.getCurrentProvider();
  if (currentProvider && browserViewManager.hasProviderView(currentProvider)) {
    browserViewManager.showProvider(currentProvider);
    return;
  }
  const initialProvider = siteEntries[0]?.[0];
  if ((options?.allowProviderViews ?? true) && initialProvider) {
    browserViewManager.showProvider(initialProvider);
  } else {
    browserViewManager.showWaiting();
  }
}

function clearProviderCatalog(): void {
  providerSites = {} as Record<ProviderKey, string>;
  providerModels = {} as Record<ProviderKey, string[]>;
  providerDefaultModes = {} as Record<ProviderKey, 'web' | 'forward'>;
  providerInputMaxChars = {} as Record<ProviderKey, number | null>;
  providerForwardBaseUrls = {} as Record<ProviderKey, string>;
  providerApiKeys = {} as Record<ProviderKey, string>;
  providerApiKeyMasked = {} as Record<ProviderKey, string>;
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
  configuredServicePort = readConfiguredServicePortFromFile();
  runtimeServicePort = configuredServicePort;
  promptConfig = readPromptConfigFromFile();
  clearProviderCatalog();
  await refreshProviderCatalogFromService();
  await ensureBrowserViewManager(window, { allowProviderViews: true });

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
      await ensureBrowserViewManager(mainWindowRef, { allowProviderViews: true });
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
  ipcMain.handle('browser:showWaiting', async () => {
    browserViewManager?.showWaiting();
    return { url: browserViewManager?.getCurrentUrl() ?? '' };
  });
  ipcMain.handle('browser:reset', async () => {
    browserViewManager?.destroy();
    browserViewManager = null;
    clearProviderCatalog();
    await refreshProviderCatalogFromService();
    if (mainWindowRef) {
      await ensureBrowserViewManager(mainWindowRef, { allowProviderViews: true });
    }
    return { ok: true };
  });
  ipcMain.handle(
    'browser:setBounds',
    async (_event, bounds: { x: number; y: number; width: number; height: number }) => {
      const clamped = clampBrowserBounds(bounds);
      lastBrowserBounds = clamped;
      browserViewManager?.setBounds(clamped);
    }
  );
  ipcMain.handle('browser:setSplitRatio', async (_event, ratio: number) => {
    if (Number.isFinite(ratio)) {
      lastSplitRatio = Math.min(0.75, Math.max(0.38, ratio));
    }
    browserViewManager?.setSplitRatio(ratio);
    if (lastBrowserBounds) {
      const clamped = clampBrowserBounds(lastBrowserBounds);
      lastBrowserBounds = clamped;
      browserViewManager?.setBounds(clamped);
    }
  });
  ipcMain.handle('browser:navigate', async (_event, url: string) => {
    try {
      await browserViewManager?.navigateTo(url);
    } catch (error) {
      const code = (error as any)?.code;
      if (code === 'ERR_ABORTED') {
        return;
      }
      throw error;
    }
  });
  ipcMain.handle('desktop:setTheme', async (_event, theme: 'dark' | 'light') => {
    desktopTheme = theme === 'light' ? 'light' : 'dark';
    nativeTheme.themeSource = desktopTheme;
    browserViewManager?.setTheme(desktopTheme);
    if (mainWindowRef) {
      mainWindowRef.setBackgroundColor(desktopTheme === 'light' ? '#f8fafc' : '#0f172a');
    }
    return { ok: true, theme: desktopTheme };
  });
  ipcMain.handle('desktop:getState', async () => {
    const managerStatus = serviceManager?.getStatus() ?? 'stopped';
    const effectiveStatus = managerStatus;

    if (effectiveStatus === 'running') {
      await refreshProviderCatalogFromService();
      if (mainWindowRef) await ensureBrowserViewManager(mainWindowRef, { allowProviderViews: true });
    }
    if (effectiveStatus === 'stopped') {
      clearProviderCatalog();
      promptConfig = readPromptConfigFromFile();
      if (mainWindowRef) await ensureBrowserViewManager(mainWindowRef, { allowProviderViews: true });
    }
    return {
      currentProvider: browserViewManager?.getCurrentProvider() ?? null,
      providerSites,
      providerModels,
      providerDefaultModes,
      providerInputMaxChars,
      providerForwardBaseUrls,
      providerApiKeys,
      providerApiKeyMasked,
      currentUrl: browserViewManager?.getCurrentUrl() ?? '',
      serviceStatus: effectiveStatus,
      servicePort: configuredServicePort,
      apiBaseUrl: getApiBaseUrl(),
      cdpUrl: CDP_URL,
      promptConfig: effectiveStatus === 'running' ? promptConfig : null,
    };
  });
  ipcMain.handle(
    'provider:updateConfig',
    async (_event, payload: { provider: string; models?: string[]; defaultMode?: 'web' | 'forward'; inputMaxChars?: number | null; forwardBaseUrl?: string; apiKey?: string }) => {
      const healthy = await probeServiceHealth(getApiBaseUrl());
      if (healthy) {
        const response = await fetch(`${getApiBaseUrl()}/v1/providers/${payload.provider}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            models: payload.models,
            default_mode: payload.defaultMode,
            input_max_chars: payload.inputMaxChars,
            forward_base_url: payload.forwardBaseUrl,
            api_key: payload.apiKey,
          }),
        });
        const raw = await response.text();
        const parsed = raw ? JSON.parse(raw) : {};
        if (!response.ok) {
          throw new Error(parsed?.error?.message ?? `更新配置失败: HTTP ${response.status}`);
        }
        await refreshProviderCatalogFromService();
        if (mainWindowRef) await ensureBrowserViewManager(mainWindowRef);
      } else {
        throw new Error('WebClawProxy 服务未启动或不可用，无法更新 Provider 配置');
      }
      return {
        ok: true,
        providerSites,
        providerModels,
        providerDefaultModes,
        providerInputMaxChars,
        providerForwardBaseUrls,
        providerApiKeys,
        providerApiKeyMasked,
      };
    }
  );
  ipcMain.handle('settings:update', async (_event, payload: { servicePort: number }) => {
    const nextPort = Number(payload.servicePort);
    if (!Number.isInteger(nextPort) || nextPort < 1 || nextPort > 65535) {
      throw new Error('端口范围必须在 1-65535');
    }
    try {
      const configPath = path.join(PROJECT_ROOT, 'config', 'default.json');
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, any>;
      raw.server = raw.server ?? {};
      raw.server.port = nextPort;
      fs.writeFileSync(configPath, JSON.stringify(raw, null, 2), 'utf-8');
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
    configuredServicePort = nextPort;
    return { ok: true, servicePort: configuredServicePort };
  });
  ipcMain.handle(
    'prompt:update',
    async (
      _event,
      payload: {
        init_prompt: string;
        init_prompt_template: string;
        user_message_template: string;
        response_schema_template: string;
        format_only_retry_template: string;
      }
    ) => {
      const configPath = path.join(PROJECT_ROOT, 'config', 'default.json');
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, any>;
      raw.prompt = {
        init_prompt: String(payload.init_prompt ?? ''),
        init_prompt_template: String(payload.init_prompt_template ?? ''),
        user_message_template: String(payload.user_message_template ?? ''),
        response_schema_template: String(payload.response_schema_template ?? ''),
        format_only_retry_template: String(payload.format_only_retry_template ?? ''),
      };
      delete raw.defaults;
      fs.writeFileSync(configPath, JSON.stringify(raw, null, 2), 'utf-8');
      promptConfig = readPromptConfigFromFile();
      return { ok: true, promptConfig };
    }
  );
  ipcMain.handle('service:start', async () => {
    const status = await serviceManager?.start() ?? 'stopped';
    if (status === 'running') {
      runtimeServicePort = configuredServicePort;
      await refreshProviderCatalogFromService();
      if (mainWindowRef) await ensureBrowserViewManager(mainWindowRef, { allowProviderViews: true });
    }
    return { status };
  });
  ipcMain.handle('service:stop', async () => {
    const status = await serviceManager?.stop() ?? 'stopped';
    const healthyBefore = await probeServiceHealth(getApiBaseUrl());
    if (healthyBefore) {
      await forceKillPortListeners(runtimeServicePort);
    }
    await new Promise((r) => setTimeout(r, 350));
    const healthyAfter = await probeServiceHealth(getApiBaseUrl());
    return { status: healthyAfter ? status : 'stopped' };
  });
  ipcMain.handle('service:restart', async () => {
    const status = await serviceManager?.restart() ?? 'stopped';
    if (status === 'running') {
      runtimeServicePort = configuredServicePort;
      await refreshProviderCatalogFromService();
      if (mainWindowRef) await ensureBrowserViewManager(mainWindowRef, { allowProviderViews: true });
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
