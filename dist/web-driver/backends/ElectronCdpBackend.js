"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElectronCdpBackend = void 0;
const playwright_extra_1 = require("playwright-extra");
class ElectronCdpBackend {
    constructor(options) {
        this.options = options;
        this.browser = null;
        this.context = null;
    }
    isReady() {
        return Boolean(this.browser && this.browser.isConnected() && this.context);
    }
    async ensureReady() {
        if (this.isReady())
            return;
        this.browser = await playwright_extra_1.chromium.connectOverCDP(this.options.cdpUrl);
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
    async getPages() {
        await this.ensureReady();
        return this.context?.pages() ?? [];
    }
    async getOrCreatePageForSite(_site, siteUrl) {
        return this.waitForMatchingPage(siteUrl);
    }
    async getOrCreatePageForUrl(url) {
        return this.waitForMatchingPage(url);
    }
    async close() {
        // GUI 模式下不要关闭 Electron 自身浏览器，只断开本地引用。
        this.context = null;
        this.browser = null;
    }
    async waitForMatchingPage(url) {
        await this.ensureReady();
        const targetHost = new URL(url).host;
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
            const pages = await this.getPages();
            const matched = pages.find((page) => {
                try {
                    return new URL(page.url()).host === targetHost;
                }
                catch {
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
exports.ElectronCdpBackend = ElectronCdpBackend;
//# sourceMappingURL=ElectronCdpBackend.js.map