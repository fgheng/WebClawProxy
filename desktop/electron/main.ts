import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const APP_DATA_ROOT = path.join(process.cwd(), '.electron-data');

app.setPath('userData', path.join(APP_DATA_ROOT, 'user-data'));
app.setPath('sessionData', path.join(APP_DATA_ROOT, 'session-data'));
app.setPath('cache', path.join(APP_DATA_ROOT, 'cache'));
app.commandLine.appendSwitch('disable-gpu');

function createMainWindow(): BrowserWindow {
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

  return window;
}

app.whenReady().then(() => {
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (url) {
      await shell.openExternal(url);
    }
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
