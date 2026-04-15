"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const browser_view_manager_1 = require("./browser-view-manager");
const provider_sites_1 = require("./provider-sites");
const service_manager_1 = require("./service-manager");
const provider_models_1 = require("./provider-models");
const shell_terminal_manager_1 = require("./shell-terminal-manager");
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const APP_DATA_ROOT = path.join(process.cwd(), '.electron-data');
const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const CDP_URL = 'http://127.0.0.1:9222';
const CDP_PORT = '9222';
let browserViewManager = null;
let serviceManager = null;
let shellTerminalManager = null;
let providerSites = {};
let providerModels = {};
electron_1.app.setPath('userData', path.join(APP_DATA_ROOT, 'user-data'));
electron_1.app.setPath('sessionData', path.join(APP_DATA_ROOT, 'session-data'));
electron_1.app.setPath('cache', path.join(APP_DATA_ROOT, 'cache'));
electron_1.app.disableHardwareAcceleration();
electron_1.app.commandLine.appendSwitch('disable-gpu');
electron_1.app.commandLine.appendSwitch('remote-debugging-port', CDP_PORT);
async function createMainWindow() {
    const window = new electron_1.BrowserWindow({
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
    }
    else {
        void window.loadFile(path.join(electron_1.app.getAppPath(), 'dist', 'index.html'));
    }
    providerSites = (0, provider_sites_1.readProviderSites)(PROJECT_ROOT);
    providerModels = (0, provider_models_1.readProviderModels)(PROJECT_ROOT);
    browserViewManager = new browser_view_manager_1.BrowserViewManager({ providerSites });
    const initialProvider = (Object.keys(providerSites)[0] ?? 'gpt');
    await browserViewManager.attach(window, initialProvider);
    serviceManager = new service_manager_1.ServiceManager(PROJECT_ROOT, 'electron-cdp', CDP_URL, window);
    shellTerminalManager = new shell_terminal_manager_1.ShellTerminalManager(PROJECT_ROOT, window);
    return window;
}
electron_1.app.whenReady().then(() => {
    electron_1.ipcMain.handle('shell:openExternal', async (_event, url) => {
        if (url) {
            await electron_1.shell.openExternal(url);
        }
    });
    electron_1.ipcMain.handle('browser:selectProvider', async (_event, provider) => {
        browserViewManager?.showProvider(provider);
        return {
            provider,
            url: browserViewManager?.getCurrentUrl() ?? '',
        };
    });
    electron_1.ipcMain.handle('browser:reloadCurrent', async () => {
        await browserViewManager?.reloadCurrentProvider();
        return { url: browserViewManager?.getCurrentUrl() ?? '' };
    });
    electron_1.ipcMain.handle('browser:openDevTools', async () => {
        await browserViewManager?.openDevTools();
    });
    electron_1.ipcMain.handle('browser:setBounds', async (_event, bounds) => {
        browserViewManager?.setBounds(bounds);
    });
    electron_1.ipcMain.handle('browser:setSplitRatio', async (_event, ratio) => {
        browserViewManager?.setSplitRatio(ratio);
    });
    electron_1.ipcMain.handle('desktop:getState', async () => {
        return {
            currentProvider: browserViewManager?.getCurrentProvider() ?? null,
            providerSites,
            providerModels,
            currentUrl: browserViewManager?.getCurrentUrl() ?? '',
            serviceStatus: serviceManager?.getStatus() ?? 'stopped',
            apiBaseUrl: 'http://127.0.0.1:3000',
            cdpUrl: CDP_URL,
        };
    });
    electron_1.ipcMain.handle('service:start', async () => ({ status: await serviceManager?.start() ?? 'stopped' }));
    electron_1.ipcMain.handle('service:stop', async () => ({ status: await serviceManager?.stop() ?? 'stopped' }));
    electron_1.ipcMain.handle('service:restart', async () => ({ status: await serviceManager?.restart() ?? 'stopped' }));
    electron_1.ipcMain.handle('terminal:init', async () => await shellTerminalManager?.ensureStarted());
    electron_1.ipcMain.handle('terminal:write', async (_event, command) => {
        await shellTerminalManager?.write(command);
    });
    electron_1.ipcMain.handle('terminal:interrupt', async () => {
        await shellTerminalManager?.interrupt();
    });
    electron_1.ipcMain.handle('terminal:resize', async (_event, cols, rows) => {
        await shellTerminalManager?.resize(cols, rows);
    });
    void createMainWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            void createMainWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
