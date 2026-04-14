import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import { BrowserViewManager } from './browser-view-manager';
import { readProviderSites, type ProviderKey } from './provider-sites';
import { ServiceManager } from './service-manager';

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const APP_DATA_ROOT = path.join(process.cwd(), '.electron-data');
const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const CDP_URL = 'http://127.0.0.1:9222';
const CDP_PORT = '9222';

let browserViewManager: BrowserViewManager | null = null;
let serviceManager: ServiceManager | null = null;
let providerSites: Record<ProviderKey, string> = {} as Record<ProviderKey, string>;

app.setPath('userData', path.join(APP_DATA_ROOT, 'user-data'));
app.setPath('sessionData', path.join(APP_DATA_ROOT, 'session-data'));
app.setPath('cache', path.join(APP_DATA_ROOT, 'cache'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('remote-debugging-port', CDP_PORT);

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

  providerSites = readProviderSites(PROJECT_ROOT);
  browserViewManager = new BrowserViewManager({ providerSites });
  const initialProvider = (Object.keys(providerSites)[0] ?? 'gpt') as ProviderKey;
  await browserViewManager.attach(window, initialProvider);

  serviceManager = new ServiceManager(PROJECT_ROOT, 'electron-cdp', CDP_URL, window);

  return window;
}

app.whenReady().then(() => {
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (url) {
      await shell.openExternal(url);
    }
  });
  ipcMain.handle('browser:selectProvider', async (_event, provider: ProviderKey) => {
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
  ipcMain.handle('desktop:getState', async () => {
    return {
      currentProvider: browserViewManager?.getCurrentProvider() ?? null,
      providerSites,
      currentUrl: browserViewManager?.getCurrentUrl() ?? '',
      serviceStatus: serviceManager?.getStatus() ?? 'stopped',
      cdpUrl: CDP_URL,
    };
  });
  ipcMain.handle('service:start', async () => ({ status: await serviceManager?.start() ?? 'stopped' }));
  ipcMain.handle('service:stop', async () => ({ status: await serviceManager?.stop() ?? 'stopped' }));
  ipcMain.handle('service:restart', async () => ({ status: await serviceManager?.restart() ?? 'stopped' }));

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
