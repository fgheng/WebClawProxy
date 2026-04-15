import { Page } from 'playwright';
import { SiteKey } from '../types';
export type BrowserBackendName = 'playwright-launch' | 'electron-cdp';
export interface BrowserBackend {
    ensureReady(): Promise<void>;
    isReady(): boolean;
    getPages(): Promise<Page[]>;
    getOrCreatePageForSite(site: SiteKey, siteUrl: string): Promise<Page>;
    getOrCreatePageForUrl(url: string): Promise<Page>;
    close(): Promise<void>;
}
//# sourceMappingURL=types.d.ts.map