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
        // 统一采用回到主页的方式创建新会话，避免污染已有 session。
        await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.dismissDialogs();
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
            const canonicalText = this.canonicalizeForDispatch(text);
            await this.clearInputArea();
            await this.fillInputRobustly(text);
            await this.sleep(200);
            const sendState = await this.waitForSendButtonStateAfterFill(canonicalText, 2000);
            await this.tryPrimarySend(sendState);
            let dispatched = await this.waitForDispatch(canonicalText, 2500);
            if (!dispatched) {
                await this.tryFallbackSend();
                dispatched = await this.waitForDispatch(canonicalText, 2000);
            }
            if (!dispatched) {
                throw new types_1.WebDriverError(types_1.WebDriverErrorCode.SEND_MESSAGE_FAILED, 'Kimi 发送后未确认投递');
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
    async getInputText() {
        return this.page.evaluate(([selector]) => {
            const el = globalThis.document.querySelector(selector);
            if (!el)
                return '';
            const tag = (el.tagName || '').toUpperCase();
            if (tag === 'TEXTAREA' || tag === 'INPUT')
                return String(el.value || '').trim();
            return String(el.textContent || '').trim();
        }, [SELECTORS.inputArea]);
    }
    canonicalizeForDispatch(text) {
        return text.replace(/\s+/g, '').trim();
    }
    async clearInputArea() {
        try {
            await this.page.fill(SELECTORS.inputArea, '');
        }
        catch {
            // ignore
        }
        const remaining = await this.getInputText();
        if (!remaining)
            return;
        await this.page.click(SELECTORS.inputArea).catch(() => null);
        await this.page.keyboard.press('Meta+A').catch(() => null);
        await this.page.keyboard.press('Backspace').catch(() => null);
        await this.sleep(80);
    }
    async fillInputRobustly(text) {
        await this.page.fill(SELECTORS.inputArea, text);
        await this.page.evaluate(([selector, value]) => {
            const el = globalThis.document.querySelector(selector);
            if (!el)
                return;
            const tag = (el.tagName || '').toUpperCase();
            if (tag === 'TEXTAREA' || tag === 'INPUT') {
                el.value = value;
            }
            else {
                el.textContent = value;
            }
            el.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
            el.dispatchEvent(new globalThis.Event('change', { bubbles: true }));
        }, [SELECTORS.inputArea, text]);
    }
    async waitForSendButtonStateAfterFill(canonicalText, timeoutMs) {
        const start = Date.now();
        let sawMounted = false;
        while (Date.now() - start < timeoutMs) {
            const state = await this.page
                .evaluate(([inputSelector, sendButtonSelector, stopButtonSelector]) => {
                const doc = globalThis.document;
                const getStyle = globalThis.getComputedStyle;
                const isVisible = (el) => {
                    if (!el)
                        return false;
                    const style = getStyle?.(el);
                    const rect = el.getBoundingClientRect?.();
                    return !style || (style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        (rect ? rect.width > 0 && rect.height > 0 : true));
                };
                const input = doc.querySelector(inputSelector);
                const sendButton = doc.querySelector(sendButtonSelector);
                const stopButton = doc.querySelector(stopButtonSelector);
                const inputText = input ? String(input.value ?? input.textContent ?? '').replace(/\s+/g, '').trim() : '';
                return {
                    inputCanonicalMatches: inputText === canonicalText,
                    sendButtonMounted: Boolean(sendButton),
                    sendButtonReady: Boolean(sendButton &&
                        isVisible(sendButton) &&
                        !sendButton.disabled &&
                        sendButton.getAttribute?.('aria-disabled') !== 'true'),
                    stopVisible: isVisible(stopButton),
                };
            }, [SELECTORS.inputArea, SELECTORS.sendButton, SELECTORS.stopButton])
                .catch(() => ({
                inputCanonicalMatches: false,
                sendButtonMounted: false,
                sendButtonReady: false,
                stopVisible: false,
            }));
            if (!state.stopVisible && state.sendButtonReady && state.inputCanonicalMatches) {
                return { mounted: true, ready: true };
            }
            if (!state.inputCanonicalMatches) {
                return { mounted: sawMounted || state.sendButtonMounted, ready: false };
            }
            sawMounted = sawMounted || state.sendButtonMounted;
            await this.sleep(120);
        }
        return { mounted: sawMounted, ready: false };
    }
    async tryPrimarySend(sendState) {
        if (sendState.ready || sendState.mounted) {
            try {
                await this.page.click(SELECTORS.sendButton, { timeout: 1000 });
                return;
            }
            catch {
                // ignore and fallback
            }
        }
        try {
            await this.page.keyboard.press('Enter');
        }
        catch {
            // ignore
        }
    }
    async tryFallbackSend() {
        try {
            await this.page.keyboard.press('Control+Enter');
        }
        catch {
            // ignore
        }
        try {
            await this.page.keyboard.press('Meta+Enter');
        }
        catch {
            // ignore
        }
        try {
            await this.page.keyboard.press('Enter');
        }
        catch {
            // ignore
        }
    }
    async waitForDispatch(canonicalText, timeoutMs) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            await this.sleep(200);
            const stopVisible = await this.page
                .waitForSelector(SELECTORS.stopButton, { timeout: 250, state: 'visible' })
                .then(() => true)
                .catch(() => false);
            if (stopVisible)
                return true;
            const currentCanonical = this.canonicalizeForDispatch(await this.getInputText());
            if (!canonicalText || currentCanonical !== canonicalText) {
                return true;
            }
        }
        const finalCanonical = this.canonicalizeForDispatch(await this.getInputText());
        return !canonicalText || finalCanonical !== canonicalText;
    }
}
exports.KimiDriver = KimiDriver;
//# sourceMappingURL=KimiDriver.js.map