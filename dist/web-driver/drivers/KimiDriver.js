"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KimiDriver = void 0;
const BaseDriver_1 = require("./BaseDriver");
const types_1 = require("../types");
/**
 * Kimi (https://www.kimi.com/) 驱动
 *
 * 选择器说明：
 * - stopButton: 使用精确选择器组合，避免 [class*="stop"] 过宽泛误匹配
 * - responseArea: 使用 [class*="segment"] 等 Kimi 特有 class，缩小匹配范围
 */
const SELECTORS = {
    loginIndicator: '[class*="user-avatar"], [class*="account"], [class*="user-info"]',
    newChatButton: 'button[class*="new"], [class*="new-chat"], [data-testid*="new"]',
    inputArea: 'textarea, [contenteditable="true"][class*="input"]',
    sendButton: 'button[class*="send"], [class*="send-button"], button[type="submit"]',
    // 停止按钮：使用精确选择器组合，避免误匹配
    // Kimi 生成中按钮通常带有 aria-label 或特定 class，不用宽泛的 [class*="stop"]
    stopButton: [
        'button[aria-label*="停止"]',
        'button[aria-label*="stop"]',
        'button[aria-label*="Stop"]',
        '[class*="stop-btn"]',
        '[class*="stopBtn"]',
        // Kimi 特有的停止按钮 class 模式
        '[class*="_stop_"]',
        '[class*="chat-stop"]',
        '[class*="generate-stop"]',
    ].join(', '),
    // 响应区域：使用更精确的 Kimi 特有 class，缩小匹配范围
    // 优先匹配带有 data-role 属性或 assistant 语义的容器
    responseArea: [
        '[data-role="assistant"]',
        '[data-message-role="assistant"]',
        '[class*="kimi-message"][class*="assistant"]',
        '[class*="chat-message"][class*="assistant"]',
        // Kimi markdown 渲染容器
        '[class*="markdown-body"]',
        '[class*="message-content"][class*="assistant"]',
    ].join(', '),
    // 回复完成后的复制按钮
    copyButton: [
        'button[aria-label*="复制"]',
        'button[aria-label*="copy"]',
        'button[title*="复制"]',
        'button[title*="copy"]',
        'button[class*="copy"]',
        '[data-testid*="copy"]',
    ].join(', '),
};
class KimiDriver extends BaseDriver_1.BaseDriver {
    constructor(page, options = {}) {
        super(page, 'https://www.kimi.com/', options);
    }
    async isLoggedIn() {
        try {
            await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.sleep(2000);
            const currentUrl = this.page.url();
            if (currentUrl.includes('/login') || currentUrl.includes('/signin')) {
                return false;
            }
            try {
                await this.page.waitForSelector(SELECTORS.loginIndicator, { timeout: 5000 });
                return true;
            }
            catch {
                return !currentUrl.includes('/login');
            }
        }
        catch {
            return false;
        }
    }
    async createNewConversation() {
        await this.dismissDialogs();
        let created = false;
        try {
            await this.page.waitForSelector(SELECTORS.newChatButton, { timeout: 5000 });
            await this.page.click(SELECTORS.newChatButton);
            created = true;
        }
        catch {
            // 导航到主页
        }
        if (!created) {
            await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }
        try {
            await this.page.waitForSelector(SELECTORS.inputArea, { timeout: 10000, state: 'visible' });
        }
        catch {
            throw new types_1.WebDriverError(types_1.WebDriverErrorCode.NEW_CONVERSATION_FAILED, 'Kimi 新建对话失败');
        }
    }
    async sendMessage(text) {
        try {
            await this.page.waitForSelector(SELECTORS.inputArea, { timeout: 10000, state: 'visible' });
            await this.page.fill(SELECTORS.inputArea, text);
            await this.sleep(300);
            try {
                await this.page.waitForSelector(SELECTORS.sendButton, { timeout: 3000, state: 'visible' });
                await this.page.click(SELECTORS.sendButton);
            }
            catch {
                await this.page.keyboard.press('Enter');
            }
        }
        catch (err) {
            if (err instanceof types_1.WebDriverError)
                throw err;
            throw new types_1.WebDriverError(types_1.WebDriverErrorCode.SEND_MESSAGE_FAILED, 'Kimi 发送消息失败', err);
        }
    }
    async extractResponse() {
        try {
            // 先尝试通过 data-role 属性精确定位助手消息（最可靠）
            let responseElements = await this.page.$$('[data-role="assistant"], [data-message-role="assistant"]');
            // 备用：通过 responseArea 选择器
            if (responseElements.length === 0) {
                responseElements = await this.page.$$(SELECTORS.responseArea);
            }
            if (responseElements.length === 0) {
                throw new types_1.WebDriverError(types_1.WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED, 'Kimi 未找到响应元素');
            }
            const lastResponse = responseElements[responseElements.length - 1];
            const content = await lastResponse.evaluate((el) => {
                // 移除思维链
                const thinkEls = el.querySelectorAll('[class*="think"], details, summary');
                thinkEls.forEach((e) => e.remove());
                // 优先取 markdown 渲染区域
                const mdEl = el.querySelector('[class*="markdown"], [class*="content"]');
                if (mdEl)
                    return mdEl.textContent?.trim() || '';
                return el.textContent?.trim() || '';
            });
            if (!content) {
                throw new types_1.WebDriverError(types_1.WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED, 'Kimi 响应内容为空');
            }
            return content;
        }
        catch (err) {
            if (err instanceof types_1.WebDriverError)
                throw err;
            throw new types_1.WebDriverError(types_1.WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED, 'Kimi 提取响应失败', err);
        }
    }
    isValidConversationUrl(url) {
        return url.startsWith('https://www.kimi.com/') && url !== 'https://www.kimi.com/';
    }
    getCopyButtonSelector() {
        return SELECTORS.copyButton;
    }
    getStopButtonSelector() {
        return SELECTORS.stopButton;
    }
    getResponseAreaSelector() {
        return SELECTORS.responseArea;
    }
    async dismissDialogs() {
        try {
            await this.page.keyboard.press('Escape');
            await this.sleep(300);
        }
        catch {
            // 忽略
        }
    }
}
exports.KimiDriver = KimiDriver;
//# sourceMappingURL=KimiDriver.js.map