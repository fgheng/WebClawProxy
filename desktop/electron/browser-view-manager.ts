import { BrowserView, BrowserWindow } from 'electron';
import type { ProviderKey } from './provider-sites';

type BrowserViewManagerOptions = {
  providerSites: Record<ProviderKey, string>;
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

export class BrowserViewManager {
  private window: BrowserWindow | null = null;
  private views = new Map<ProviderKey, BrowserView>();
  private currentProvider: ProviderKey | null = null;
  private splitRatio = 0.56;
  private explicitBounds: ViewBounds | null = null;

  constructor(private readonly options: BrowserViewManagerOptions) {}

  async attach(window: BrowserWindow, initialProvider: ProviderKey): Promise<void> {
    this.window = window;
    for (const [provider, siteUrl] of Object.entries(this.options.providerSites) as [ProviderKey, string][]) {
      const view = new BrowserView({
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

  getCurrentProvider(): ProviderKey | null {
    return this.currentProvider;
  }

  getProviderSites(): Record<ProviderKey, string> {
    return this.options.providerSites;
  }

  showProvider(provider: ProviderKey): void {
    if (!this.window) return;
    const nextView = this.views.get(provider);
    if (!nextView) return;

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

  async reloadCurrentProvider(): Promise<void> {
    if (!this.currentProvider) return;
    const view = this.views.get(this.currentProvider);
    await view?.webContents.reload();
  }

  async openDevTools(): Promise<void> {
    if (!this.currentProvider) return;
    const view = this.views.get(this.currentProvider);
    view?.webContents.openDevTools({ mode: 'detach' });
  }

  getCurrentUrl(): string {
    if (!this.currentProvider) return '';
    return this.views.get(this.currentProvider)?.webContents.getURL() ?? '';
  }

  setSplitRatio(ratio: number): void {
    this.splitRatio = Math.min(0.75, Math.max(0.38, ratio));
    this.updateBounds();
  }

  setBounds(bounds: ViewBounds): void {
    this.explicitBounds = bounds;
    this.updateBounds();
  }

  navigateTo(url: string): Promise<void> {
    if (!this.window || !this.currentProvider) return Promise.resolve();
    const view = this.views.get(this.currentProvider);
    if (!view) return Promise.resolve();
    return view.webContents.loadURL(url);
  }

  private updateBounds(): void {
    if (!this.window || !this.currentProvider) return;
    const view = this.views.get(this.currentProvider);
    if (!view) return;

    if (this.explicitBounds) {
      view.setBounds({
        x: this.explicitBounds.x,
        y: this.explicitBounds.y,
        width: Math.max(320, this.explicitBounds.width),
        height: Math.max(200, this.explicitBounds.height),
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
    view.setAutoResize({ width: true, height: true });
  }
}
