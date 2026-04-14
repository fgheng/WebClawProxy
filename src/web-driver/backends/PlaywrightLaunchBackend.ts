import { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright-extra';
import type { SiteKey } from '../types';
import type { BrowserBackend } from './types';

type PlaywrightLaunchBackendOptions = {
  headless: boolean;
  userDataDir: string;
  userAgent: string;
};

export class PlaywrightLaunchBackend implements BrowserBackend {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  constructor(private readonly options: PlaywrightLaunchBackendOptions) {}

  isReady(): boolean {
    return Boolean(this.context && this.browser && this.browser.isConnected());
  }

  async ensureReady(): Promise<void> {
    if (this.isReady()) return;

    const context = await (chromium as any).launchPersistentContext(this.options.userDataDir, {
      headless: this.options.headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-save-password-bubble',
        '--window-size=1280,800',
        '--lang=zh-CN,zh,en',
      ],
      viewport: { width: 1280, height: 800 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      permissions: ['clipboard-read', 'clipboard-write'],
      userAgent: this.options.userAgent,
      ignoreDefaultArgs: ['--enable-automation'],
    });
    this.context = context;

    const browser = context.browser();
    if (!browser) {
      throw new Error('Playwright 持久化上下文未返回浏览器实例');
    }
    this.browser = browser;

    await context.addInitScript(() => {
      const nav = (globalThis as any).navigator;
      Object.defineProperty(nav, 'webdriver', { get: () => undefined });
      Object.defineProperty(nav, 'language', { get: () => 'zh-CN' });
      Object.defineProperty(nav, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
      Object.defineProperty(nav, 'hardwareConcurrency', { get: () => 8 });
      Object.defineProperty(nav, 'platform', { get: () => 'MacIntel' });
    });
  }

  async getPages(): Promise<Page[]> {
    await this.ensureReady();
    return this.context?.pages?.() ?? [];
  }

  async getOrCreatePageForSite(_site: SiteKey, siteUrl: string): Promise<Page> {
    return this.getOrCreatePageForUrl(siteUrl);
  }

  async getOrCreatePageForUrl(url: string): Promise<Page> {
    await this.ensureReady();
    const targetHost = new URL(url).host;
    const reusableByHost = (this.context?.pages?.() ?? []).find((page) => {
      try {
        return new URL(page.url()).host === targetHost;
      } catch {
        return false;
      }
    });

    return reusableByHost ?? (await this.context!.newPage());
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
