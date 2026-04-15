"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserViewManager = void 0;
const electron_1 = require("electron");
const TOP_STATUS_BAR_HEIGHT = 0;
const BROWSER_PADDING_X = 18;
const BROWSER_AREA_TOP = 72;
const BOTTOM_ACTION_BAR_HEIGHT = 24;
class BrowserViewManager {
    constructor(options) {
        this.options = options;
        this.window = null;
        this.views = new Map();
        this.currentProvider = null;
        this.splitRatio = 0.56;
        this.explicitBounds = null;
    }
    async attach(window, initialProvider) {
        this.window = window;
        for (const [provider, siteUrl] of Object.entries(this.options.providerSites)) {
            const view = new electron_1.BrowserView({
                webPreferences: {
                    partition: `persist:webclaw-${provider}`,
                    sandbox: false,
                },
            });
            await view.webContents.loadURL(siteUrl);
            this.views.set(provider, view);
        }
        this.showProvider(initialProvider);
        window.on('resize', () => this.updateBounds());
        window.on('resized', () => this.updateBounds());
    }
    getCurrentProvider() {
        return this.currentProvider;
    }
    getProviderSites() {
        return this.options.providerSites;
    }
    showProvider(provider) {
        if (!this.window)
            return;
        const nextView = this.views.get(provider);
        if (!nextView)
            return;
        if (this.currentProvider) {
            const currentView = this.views.get(this.currentProvider);
            if (currentView) {
                this.window.removeBrowserView(currentView);
            }
        }
        this.currentProvider = provider;
        this.window.addBrowserView(nextView);
        this.updateBounds();
    }
    async reloadCurrentProvider() {
        if (!this.currentProvider)
            return;
        const view = this.views.get(this.currentProvider);
        await view?.webContents.reload();
    }
    async openDevTools() {
        if (!this.currentProvider)
            return;
        const view = this.views.get(this.currentProvider);
        view?.webContents.openDevTools({ mode: 'detach' });
    }
    getCurrentUrl() {
        if (!this.currentProvider)
            return '';
        return this.views.get(this.currentProvider)?.webContents.getURL() ?? '';
    }
    setSplitRatio(ratio) {
        this.splitRatio = Math.min(0.75, Math.max(0.38, ratio));
        this.updateBounds();
    }
    setBounds(bounds) {
        this.explicitBounds = bounds;
        this.updateBounds();
    }
    updateBounds() {
        if (!this.window || !this.currentProvider)
            return;
        const view = this.views.get(this.currentProvider);
        if (!view)
            return;
        if (this.explicitBounds) {
            view.setBounds({
                x: this.explicitBounds.x,
                y: this.explicitBounds.y,
                width: Math.max(320, this.explicitBounds.width),
                height: Math.max(200, this.explicitBounds.height),
            });
        }
        else {
            const [windowWidth, windowHeight] = this.window.getContentSize();
            const mainHeight = windowHeight - TOP_STATUS_BAR_HEIGHT - BOTTOM_ACTION_BAR_HEIGHT;
            const topAreaHeight = Math.floor(mainHeight * this.splitRatio);
            const width = Math.max(640, windowWidth - BROWSER_PADDING_X * 2);
            const height = Math.max(280, topAreaHeight - (BROWSER_AREA_TOP - TOP_STATUS_BAR_HEIGHT) - 12);
            view.setBounds({
                x: BROWSER_PADDING_X,
                y: BROWSER_AREA_TOP,
                width,
                height,
            });
        }
        view.setAutoResize({ width: true, height: true });
    }
}
exports.BrowserViewManager = BrowserViewManager;
