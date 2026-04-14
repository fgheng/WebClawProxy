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
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const APP_DATA_ROOT = path.join(process.cwd(), '.electron-data');
electron_1.app.setPath('userData', path.join(APP_DATA_ROOT, 'user-data'));
electron_1.app.setPath('sessionData', path.join(APP_DATA_ROOT, 'session-data'));
electron_1.app.setPath('cache', path.join(APP_DATA_ROOT, 'cache'));
electron_1.app.commandLine.appendSwitch('disable-gpu');
function createMainWindow() {
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
    return window;
}
electron_1.app.whenReady().then(() => {
    electron_1.ipcMain.handle('shell:openExternal', async (_event, url) => {
        if (url) {
            await electron_1.shell.openExternal(url);
        }
    });
    createMainWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
