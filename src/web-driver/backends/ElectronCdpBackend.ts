import { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright-extra';
import type { SiteKey } from '../types';
import type { BrowserBackend } from './types';

type ElectronCdpBackendOptions = {
  cdpUrl: string;
};

export class ElectronCdpBackend implements BrowserBackend {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  constructor(private readonly options: ElectronCdpBackendOptions) {}

  isReady(): boolean {
    return Boolean(this.browser && this.browser.isConnected() && this.context);
  }

  async ensureReady(): Promise<void> {
    if (this.isReady()) return;

    this.browser = await (chromium as any).connectOverCDP(this.options.cdpUrl);

    const browser = this.browser;
    if (!browser) {
      throw new Error('Electron CDP 浏览器未初始化');
    }

    const contexts = browser.contexts();
    if (contexts.length === 0) {
      throw new Error('Electron CDP 连接成功，但未发现可用浏览器上下文');
    }

    this.context = contexts[0];
  }

  async getPages(): Promise<Page[]> {
    await this.ensureReady();
    return this.context?.pages() ?? [];
  }

  async getOrCreatePageForSite(_site: SiteKey, siteUrl: string): Promise<Page> {
    return this.waitForMatchingPage(siteUrl);
  }

  async getOrCreatePageForUrl(url: string): Promise<Page> {
    return this.waitForMatchingPage(url);
  }

  async close(): Promise<void> {
    // GUI 模式下不要关闭 Electron 自身浏览器，只断开本地引用。
    this.context = null;
    this.browser = null;
  }

  private async waitForMatchingPage(url: string): Promise<Page> {
    await this.ensureReady();
    const targetHost = new URL(url).host;
    const deadline = Date.now() + 15000;

    while (Date.now() < deadline) {
      const pages = await this.getPages();
      const matched = pages.find((page) => {
        try {
          return new URL(page.url()).host === targetHost;
        } catch {
          return false;
        }
      });

      if (matched) {
        return matched;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`Electron CDP 未找到目标页面: ${url}`);
  }
}
