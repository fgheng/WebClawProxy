import { BrowserView, BrowserWindow } from 'electron';
import * as path from 'path';
import type { ProviderKey } from './provider-sites';

type BrowserViewManagerOptions = {
  providerSites: Record<ProviderKey, string>;
  theme?: 'dark' | 'light';
};

const TOP_STATUS_BAR_HEIGHT = 0;
const BROWSER_PADDING_X = 18;
const BROWSER_AREA_TOP = 72;
const BOTTOM_ACTION_BAR_HEIGHT = 24;

type ViewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

let browserViewTheme: 'dark' | 'light' = 'dark';

function buildLoadingUrl(targetUrl?: string, state: 'loading' | 'timeout' = 'loading'): string {
  const loadingPath = path.join(process.cwd(), 'electron', 'loading.html');
  const theme = browserViewTheme;
  if (!targetUrl) {
    return `file://${loadingPath}?theme=${theme}`;
  }
  const encodedTarget = encodeURIComponent(targetUrl);
  return `file://${loadingPath}?theme=${theme}&state=${state}&target=${encodedTarget}`;
}

function isNetworkLoadError(errorCode: number): boolean {
  return errorCode === -118 || errorCode === -101 || errorCode === -102 || errorCode === -105 || errorCode === -2;
}

export class BrowserViewManager {
  private window: BrowserWindow | null = null;
  private views = new Map<ProviderKey, BrowserView>();
  private failedProviders = new Set<ProviderKey>();
  private loadStateByProvider = new Map<ProviderKey, { targetUrl: string; state: 'loading' | 'timeout' }>();
  private timeoutTimerByProvider = new Map<ProviderKey, ReturnType<typeof setTimeout>>();
  private waitingView: BrowserView | null = null;
  private activeView: BrowserView | null = null;
  private currentProvider: ProviderKey | null = null;
  private splitRatio = 0.56;
  private explicitBounds: ViewBounds | null = null;
  private readonly onWindowResize = () => this.updateBounds();
  private readonly onWindowResized = () => this.updateBounds();

  constructor(private readonly options: BrowserViewManagerOptions) {}

  private applyThemeToView(view: BrowserView): void {
    const wc = view.webContents;
    const color = browserViewTheme === 'light' ? '#ffffff' : '#0b1220';
    try {
      (wc as unknown as { setBackgroundColor?: (hexColor: string) => void }).setBackgroundColor?.(color);
    } catch {
    }
  }

  private armTimeout(provider: ProviderKey, view: BrowserView, targetUrl: string): void {
    const existing = this.timeoutTimerByProvider.get(provider);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      try {
        const url = view.webContents.getURL();
        const isLoading = (view.webContents as unknown as { isLoading?: () => boolean }).isLoading?.() ?? false;
        if (!isLoading) return;
        if (url.startsWith('file://') && url.includes('loading.html')) return;
        this.loadStateByProvider.set(provider, { targetUrl, state: 'timeout' });
        void view.webContents.loadURL(buildLoadingUrl(targetUrl, 'timeout'));
      } catch {
      }
    }, 30000);
    this.timeoutTimerByProvider.set(provider, timer);
  }

  async attach(window: BrowserWindow, initialProvider: ProviderKey | null): Promise<void> {
    this.window = window;
    browserViewTheme = this.options.theme === 'light' ? 'light' : 'dark';
    this.waitingView = new BrowserView({
      webPreferences: {
        partition: 'persist:webclaw-waiting',
        sandbox: false,
      },
    });
    this.applyThemeToView(this.waitingView);
    await this.waitingView.webContents.loadURL(buildLoadingUrl());
    await this.syncProviderSites(this.options.providerSites);
    if (initialProvider && this.views.has(initialProvider)) {
      this.showProvider(initialProvider);
    } else {
      this.showWaiting();
    }
    window.on('resize', this.onWindowResize);
    window.on('resized', this.onWindowResized);
  }

  getCurrentProvider(): ProviderKey | null {
    return this.currentProvider;
  }

  getProviderSites(): Record<ProviderKey, string> {
    return this.options.providerSites;
  }

  async syncProviderSites(nextProviderSites: Record<ProviderKey, string>): Promise<void> {
    this.options.providerSites = nextProviderSites;
    for (const [provider, siteUrl] of Object.entries(nextProviderSites) as [ProviderKey, string][]) {
      if (!siteUrl || !siteUrl.trim()) continue;
      if (this.views.has(provider)) continue;
      const view = new BrowserView({
        webPreferences: {
          partition: `persist:webclaw-${provider}`,
          sandbox: false,
        },
      });
      this.applyThemeToView(view);
      view.webContents.on('did-stop-loading', () => {
        const timer = this.timeoutTimerByProvider.get(provider);
        if (timer) clearTimeout(timer);
        this.timeoutTimerByProvider.delete(provider);
      });
      view.webContents.on('did-fail-load', (_event, errorCode, _errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        if (!validatedURL || validatedURL.startsWith('file://')) return;
        if (!isNetworkLoadError(errorCode)) return;
        this.loadStateByProvider.set(provider, { targetUrl: validatedURL, state: 'timeout' });
        void view.webContents.loadURL(buildLoadingUrl(validatedURL, 'timeout'));
      });
      this.views.set(provider, view);
      this.loadStateByProvider.set(provider, { targetUrl: siteUrl, state: 'loading' });
      this.armTimeout(provider, view, siteUrl);
      void view.webContents
        .loadURL(buildLoadingUrl(siteUrl, 'loading'))
        .then(() => {
          this.failedProviders.delete(provider);
        })
        .catch(() => {
          this.failedProviders.add(provider);
        });
    }
    if (this.currentProvider && !nextProviderSites[this.currentProvider]) {
      this.currentProvider = null;
      this.showWaiting();
    }
  }

  showProvider(provider: ProviderKey): void {
    if (!this.window) return;
    const nextView = this.views.get(provider);
    if (!nextView) {
      this.currentProvider = null;
      this.showWaiting();
      return;
    }
    if (this.currentProvider === provider && this.activeView === nextView) {
      this.updateBounds();
      return;
    }
    this.detachActiveView();
    this.currentProvider = provider;
    this.activeView = nextView;
    this.window.addBrowserView(nextView);
    const expectedUrl = this.options.providerSites[provider];
    const currentUrl = nextView.webContents.getURL();
    if (expectedUrl && (!currentUrl || currentUrl === 'about:blank')) {
      this.loadStateByProvider.set(provider, { targetUrl: expectedUrl, state: 'loading' });
      this.armTimeout(provider, nextView, expectedUrl);
      void nextView.webContents
        .loadURL(buildLoadingUrl(expectedUrl, 'loading'))
        .then(() => {
          this.failedProviders.delete(provider);
        })
        .catch(() => {
          this.failedProviders.add(provider);
        });
    }
    this.updateBounds();
  }

  showWaiting(): void {
    if (!this.window || !this.waitingView) return;
    if (this.activeView === this.waitingView) {
      this.updateBounds();
      return;
    }
    this.detachActiveView();
    this.activeView = this.waitingView;
    this.window.addBrowserView(this.waitingView);
    this.updateBounds();
  }

  async reloadCurrentProvider(): Promise<void> {
    if (this.currentProvider) {
      const view = this.views.get(this.currentProvider);
      await view?.webContents.reload();
      return;
    }
    await this.activeView?.webContents.reload();
  }

  async openDevTools(): Promise<void> {
    const view = this.currentProvider
      ? this.views.get(this.currentProvider)
      : this.activeView;
    view?.webContents.openDevTools({ mode: 'detach' });
  }

  getCurrentUrl(): string {
    return this.activeView?.webContents.getURL() ?? '';
  }

  setSplitRatio(ratio: number): void {
    this.splitRatio = Math.min(0.75, Math.max(0.38, ratio));
    this.updateBounds();
  }

  setTheme(theme: 'dark' | 'light'): void {
    browserViewTheme = theme === 'light' ? 'light' : 'dark';
    if (!this.waitingView) return;
    this.applyThemeToView(this.waitingView);
    for (const view of this.views.values()) {
      this.applyThemeToView(view);
    }
    if (this.activeView === this.waitingView) {
      void this.waitingView.webContents.loadURL(buildLoadingUrl());
      return;
    }
    if (this.currentProvider) {
      const view = this.views.get(this.currentProvider);
      if (!view) return;
      const url = view.webContents.getURL();
      if (url.startsWith('file://') && url.includes('loading.html')) {
        const state = this.loadStateByProvider.get(this.currentProvider);
        if (state) {
          void view.webContents.loadURL(buildLoadingUrl(state.targetUrl, state.state));
        }
      }
    }
  }

  setBounds(bounds: ViewBounds): void {
    if (
      this.explicitBounds &&
      this.explicitBounds.x === bounds.x &&
      this.explicitBounds.y === bounds.y &&
      this.explicitBounds.width === bounds.width &&
      this.explicitBounds.height === bounds.height
    ) {
      return;
    }
    this.explicitBounds = bounds;
    this.updateBounds();
  }

  navigateTo(url: string): Promise<void> {
    if (!this.window) return Promise.resolve();
    const view = this.currentProvider
      ? this.views.get(this.currentProvider)
      : this.activeView;
    if (!view) return Promise.resolve();
    return view.webContents.loadURL(url);
  }

  hasProviderView(provider: ProviderKey): boolean {
    return this.views.has(provider);
  }

  destroy(): void {
    if (this.window) {
      try {
        this.window.removeListener('resize', this.onWindowResize);
        this.window.removeListener('resized', this.onWindowResized);
      } catch {
        // ignore
      }
      try {
        if (this.activeView) this.window.removeBrowserView(this.activeView);
      } catch {
        // ignore
      }
      for (const view of this.views.values()) {
        try {
          this.window.removeBrowserView(view);
        } catch {
          // ignore
        }
      }
      if (this.waitingView) {
        try {
          this.window.removeBrowserView(this.waitingView);
        } catch {
          // ignore
        }
      }
    }

    for (const view of this.views.values()) {
      try {
        const wc = view.webContents as unknown as { destroy?: () => void; close?: () => void };
        if (typeof wc.destroy === 'function') wc.destroy();
        else if (typeof wc.close === 'function') wc.close();
      } catch {
        // ignore
      }
    }
    if (this.waitingView) {
      try {
        const wc = this.waitingView.webContents as unknown as { destroy?: () => void; close?: () => void };
        if (typeof wc.destroy === 'function') wc.destroy();
        else if (typeof wc.close === 'function') wc.close();
      } catch {
        // ignore
      }
    }

    for (const timer of this.timeoutTimerByProvider.values()) {
      clearTimeout(timer);
    }
    this.timeoutTimerByProvider.clear();

    this.views.clear();
    this.waitingView = null;
    this.activeView = null;
    this.currentProvider = null;
    this.window = null;
  }

  private detachActiveView(): void {
    if (!this.window || !this.activeView) return;
    this.window.removeBrowserView(this.activeView);
    this.activeView = null;
  }

  private updateBounds(): void {
    if (!this.window) return;
    const view = this.activeView;
    if (!view) return;

    if (this.explicitBounds) {
      view.setBounds({
        x: this.explicitBounds.x,
        y: this.explicitBounds.y,
        width: Math.max(1, this.explicitBounds.width),
        height: Math.max(1, this.explicitBounds.height),
      });
    } else {
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
    view.setAutoResize({ width: false, height: false });
  }
}
