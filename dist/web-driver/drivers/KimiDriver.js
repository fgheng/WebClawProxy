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
    // 响应区域：优先 assistant 语义，补充 Kimi 新版 segment 结构
    // 注意：Kimi 实站存在“assistant 节点通过 segment 承载，且回复完成后才出现动作按钮组”的形态
    responseArea: [
        '[data-role="assistant"]',
        '[data-message-role="assistant"]',
        '[data-author-role="assistant"]',
        '[class*="kimi-message"][class*="assistant"]',
        '[class*="chat-message"][class*="assistant"]',
        '[class*="message-content"][class*="assistant"]',
        // Kimi 新版常见 segment 形态（放在后面做兜底）
        '[class*="segment"][class*="assistant"]',
        '[class*="segment-assistant"]',
        '[class*="segment"]',
        // markdown 渲染容器
        '[class*="markdown-body"]',
        '[class*="markdown"]',
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
            const candidates = [];
            // 1) 语义化 assistant 节点（优先）
            const semanticAssistant = await this.page.$$('[data-role="assistant"], [data-message-role="assistant"], [data-author-role="assistant"]');
            candidates.push(...semanticAssistant);
            // 2) 备用：所有可能的消息节点，筛选 assistant 特征
            if (candidates.length === 0) {
                const allMessages = await this.page.$$('[class*="message"], [class*="chat-message"], [class*="segment"], [class*="item"]');
                for (const msg of allMessages) {
                    const isAssistant = await msg.evaluate((el) => {
                        const cls = String(el.className || '').toLowerCase();
                        const role = (el.getAttribute('data-role') ||
                            el.getAttribute('data-message-role') ||
                            el.getAttribute('data-author-role') ||
                            '').toLowerCase();
                        return (role === 'assistant' ||
                            cls.includes('assistant') ||
                            Boolean(el.querySelector('[class*="markdown"], [class*="message-content"]')));
                    });
                    if (isAssistant)
                        candidates.push(msg);
                }
            }
            // 3) 兜底：responseArea 命中节点
            if (candidates.length === 0) {
                const responseElements = await this.page.$$(SELECTORS.responseArea);
                candidates.push(...responseElements);
            }
            if (candidates.length === 0) {
                throw new types_1.WebDriverError(types_1.WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED, 'Kimi 未找到响应元素');
            }
            // 从后往前找最后一个非空响应
            for (let i = candidates.length - 1; i >= 0; i--) {
                const content = await candidates[i].evaluate((el) => {
                    // 在 clone 上移除思维链，避免污染原页面
                    const cloned = el.cloneNode(true);
                    const thinkEls = cloned.querySelectorAll('[class*="think"], [class*="reason"], [class*="cot"], details, summary');
                    thinkEls.forEach((e) => e.remove());
                    // 优先取代码块（Deep/JSON 场景更稳定）
                    const codeNodes = Array.from(cloned.querySelectorAll('pre code, code[class*="language"], pre'));
                    const codeTexts = codeNodes
                        .map((n) => (n.textContent || '').trim())
                        .filter((t) => t.length > 0);
                    if (codeTexts.length > 0) {
                        return codeTexts.sort((a, b) => b.length - a.length)[0];
                    }
                    const mdEl = cloned.querySelector('[class*="markdown"], [class*="message-content"], [class*="content"]');
                    const text = (mdEl ? mdEl.textContent : cloned.textContent) || '';
                    return text.replace(/\s+/g, ' ').trim();
                });
                if (content)
                    return content;
            }
            throw new types_1.WebDriverError(types_1.WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED, 'Kimi 响应内容为空');
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
    getStopButtonSelector() {
        // 允许 Kimi 参与 stop 信号判定；若 stop 信号不可靠，基类会自动回退内容稳定性策略
        return SELECTORS.stopButton;
    }
    getResponseAreaSelector() {
        return SELECTORS.responseArea;
    }
    async getLatestResponseText(responseSelector) {
        return this.page.evaluate(([selector]) => {
            const nodes = Array.from(globalThis.document.querySelectorAll(selector));
            if (nodes.length === 0)
                return '';
            const getText = (el) => {
                const mdEl = el.querySelector('[class*="markdown"], [class*="message-content"], [class*="content"]');
                const raw = (mdEl ? mdEl.textContent : el.textContent) || '';
                return String(raw).replace(/\s+/g, ' ').trim();
            };
            const isLikelyUserNode = (el) => {
                const cls = String(el.className || '').toLowerCase();
                const role = String(el.getAttribute?.('data-role') ||
                    el.getAttribute?.('data-message-role') ||
                    el.getAttribute?.('data-author-role') ||
                    '').toLowerCase();
                if (role === 'user' || role === 'human')
                    return true;
                if (role === 'assistant')
                    return false;
                return (cls.includes('user') ||
                    cls.includes('human') ||
                    cls.includes('self') ||
                    cls.includes('mine'));
            };
            // 第一轮：优先找“非用户节点”的最后一个非空内容
            for (let i = nodes.length - 1; i >= 0; i--) {
                const node = nodes[i];
                if (isLikelyUserNode(node))
                    continue;
                const text = getText(node);
                if (text.length > 0)
                    return text;
            }
            // 第二轮兜底：若无法区分角色，退化为最后一个非空节点
            for (let i = nodes.length - 1; i >= 0; i--) {
                const text = getText(nodes[i]);
                if (text.length > 0)
                    return text;
            }
            return '';
        }, [responseSelector]);
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