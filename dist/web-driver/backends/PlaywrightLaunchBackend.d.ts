import { Page } from 'playwright';
import type { SiteKey } from '../types';
import type { BrowserBackend } from './types';
type PlaywrightLaunchBackendOptions = {
    headless: boolean;
    userDataDir: string;
    userAgent: string;
};
export declare class PlaywrightLaunchBackend implements BrowserBackend {
    private readonly options;
    private browser;
    private context;
    constructor(options: PlaywrightLaunchBackendOptions);
    isReady(): boolean;
    ensureReady(): Promise<void>;
    getPages(): Promise<Page[]>;
    getOrCreatePageForSite(_site: SiteKey, siteUrl: string): Promise<Page>;
    getOrCreatePageForUrl(url: string): Promise<Page>;
    close(): Promise<void>;
}
export {};
//# sourceMappingURL=PlaywrightLaunchBackend.d.ts.map