import { Page } from 'playwright';
import type { SiteKey } from '../types';
import type { BrowserBackend } from './types';
type ElectronCdpBackendOptions = {
    cdpUrl: string;
};
export declare class ElectronCdpBackend implements BrowserBackend {
    private readonly options;
    private browser;
    private context;
    constructor(options: ElectronCdpBackendOptions);
    isReady(): boolean;
    ensureReady(): Promise<void>;
    getPages(): Promise<Page[]>;
    getOrCreatePageForSite(_site: SiteKey, siteUrl: string): Promise<Page>;
    getOrCreatePageForUrl(url: string): Promise<Page>;
    close(): Promise<void>;
    private waitForMatchingPage;
}
export {};
//# sourceMappingURL=ElectronCdpBackend.d.ts.map