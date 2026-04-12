"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QwenDriver = void 0;
const BaseDriver_1 = require("./BaseDriver");
const types_1 = require("../types");
/**
 * Qwen (https://chat.qwen.ai/) 驱动
 *
 * 选择器说明：
 * - stopButton: 使用精确选择器组合，避免 button[class*="stop"] 过宽泛误匹配
 * - responseArea: 优先使用 data-role/data-message-role 语义属性定位助手消息
 */
const SELECTORS = {
    loginIndicator: '.user-avatar, [class*="avatar"], [class*="user-info"]',
    newChatButton: '[class*="new-chat"], button[title*="新建"], button[title*="New"]',
    newChatButtonAlt: 'button[class*="new"], [data-testid*="new"]',
    inputArea: 'textarea, [contenteditable="true"]',
    sendButton: 'button[class*="send"], button[type="submit"]',
    assistantMessage: [
        '[data-role="assistant"]',
        '[data-message-role="assistant"]',
        '[data-author-role="assistant"]',
        '[class*="message"][class*="assistant"]',
        '[class*="chat-message"][class*="assistant"]',
    ].join(', '),
    // 停止按钮：使用精确选择器组合，避免 button[class*="stop"] 误匹配无关元素
    stopButton: [
        'button[aria-label*="停止"]',
        'button[aria-label*="stop"]',
        'button[aria-label*="Stop"]',
        'button[title*="停止"]',
        'button[title*="stop"]',
        '[class*="stop-btn"]',
        '[class*="stopBtn"]',
        '[class*="generate-stop"]',
        '[class*="chat-stop"]',
        // Qwen 特有的停止按钮 class 模式
        '[class*="_stop_"]',
    ].join(', '),
    // 响应区域：优先使用语义属性，避免宽泛的 [class*="answer"]、[class*="response"]
    // 这些宽泛选择器会匹配到用户消息框、输入框等无关元素
    responseArea: [
        '[data-role="assistant"]',
        '[data-message-role="assistant"]',
        '[data-author-role="assistant"]',
        // Qwen 的消息容器（使用 class 组合约束，减少误匹配）
        '[class*="message"][class*="assistant"]',
        '[class*="chat-message"][class*="assistant"]',
        // Qwen markdown 渲染容器
        '[class*="markdown-body"]',
        '[class*="message-content-wrapper"]',
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
class QwenDriver extends BaseDriver_1.BaseDriver {
    constructor(page, options = {}) {
        super(page, 'https://chat.qwen.ai/', options);
        this.lastAssistantResponseText = '';
        this.pendingResponseBaseCount = 0;
    }
    /**
     * 检查是否已登录
     * 只在当前不在 Qwen 页面时才主动导航，避免重复刷新触发弹窗
     */
    async isLoggedIn() {
        try {
            const currentUrl = this.page.url();
            if (!currentUrl.includes('qwen.ai') && !currentUrl.includes('aliyun.com')) {
                await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await this.sleep(2000);
            }
            const url = this.page.url();
            if (url.includes('/login') || url.includes('/signin')) {
                return false;
            }
            try {
                await this.page.waitForSelector(SELECTORS.loginIndicator, { timeout: 5000 });
                return true;
            }
            catch {
                return !url.includes('/login');
            }
        }
        catch {
            return false;
        }
    }
    async createNewConversation() {
        // 先尝试关闭弹窗
        await this.dismissDialogs();
        let created = false;
        // 尝试多个新建按钮选择器
        for (const selector of [SELECTORS.newChatButton, SELECTORS.newChatButtonAlt]) {
            try {
                await this.page.waitForSelector(selector, { timeout: 3000 });
                await this.page.click(selector);
                created = true;
                break;
            }
            catch {
                continue;
            }
        }
        if (!created) {
            // 直接导航到主页作为新建对话
            await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }
        try {
            await this.page.waitForSelector(SELECTORS.inputArea, { timeout: 10000, state: 'visible' });
        }
        catch {
            throw new types_1.WebDriverError(types_1.WebDriverErrorCode.NEW_CONVERSATION_FAILED, 'Qwen 新建对话失败');
        }
    }
    async sendMessage(text) {
        try {
            await this.page.waitForSelector(SELECTORS.inputArea, { timeout: 10000, state: 'visible' });
            const beforeCount = await this.getAssistantMessageCount();
            this.pendingResponseBaseCount = beforeCount;
            await this.fillInputRobustly(text);
            await this.sleep(200);
            // 首轮发送尝试：点击发送按钮 -> Enter
            await this.tryPrimarySend();
            let dispatched = await this.waitForDispatch(text, beforeCount, 2500);
            // 二次兜底：Ctrl/Cmd+Enter，再确认一次
            if (!dispatched) {
                await this.tryFallbackSend();
                dispatched = await this.waitForDispatch(text, beforeCount, 2000);
            }
            // 注意：Qwen 某些版本发送后输入框不会立即清空，不能在此直接判失败
            if (!dispatched) {
                console.warn('[QwenDriver] dispatch confirmation not observed immediately, continue to response waiting');
            }
        }
        catch (err) {
            if (err instanceof types_1.WebDriverError)
                throw err;
            throw new types_1.WebDriverError(types_1.WebDriverErrorCode.SEND_MESSAGE_FAILED, 'Qwen 发送消息失败', err);
        }
    }
    async extractResponse() {
        try {
            const deadline = Date.now() + Math.min(this.responseTimeoutMs, 30000);
            while (Date.now() < deadline) {
                // 优先通过 data-role 属性精确定位助手消息（最可靠）
                let responseElements = await this.page.$$(SELECTORS.assistantMessage);
                // 备用：通过 responseArea 选择器
                if (responseElements.length === 0) {
                    responseElements = await this.page.$$(SELECTORS.responseArea);
                }
                if (responseElements.length === 0) {
                    await this.sleep(300);
                    continue;
                }
                const currentCount = responseElements.length;
                const latestFirst = [...responseElements].reverse();
                let picked = '';
                for (const candidate of latestFirst) {
                    const content = await candidate.evaluate((el) => {
                        // 过滤思维链（通常在 details 或特定 class 中）
                        const thinkEls = el.querySelectorAll('details, [class*="think"], [class*="reasoning"]');
                        thinkEls.forEach((e) => e.remove());
                        // 优先取 markdown 渲染区域
                        const mdEl = el.querySelector('[class*="markdown"], [class*="content"]');
                        const raw = mdEl ? mdEl.textContent || '' : el.textContent || '';
                        return raw.replace(/\s+/g, ' ').trim();
                    });
                    if (!content)
                        continue;
                    if (this.isThinkingPlaceholder(content))
                        continue;
                    picked = content;
                    break;
                }
                // 还没产出最终回复，继续等
                if (!picked) {
                    await this.sleep(400);
                    continue;
                }
                // 防止拿到上一轮旧回复
                if (currentCount <= this.pendingResponseBaseCount && picked === this.lastAssistantResponseText) {
                    await this.sleep(300);
                    continue;
                }
                this.lastAssistantResponseText = picked;
                this.pendingResponseBaseCount = currentCount;
                return picked;
            }
            throw new types_1.WebDriverError(types_1.WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED, 'Qwen 尚未产出可用最终回复（可能仍在思考或发送未生效）');
        }
        catch (err) {
            if (err instanceof types_1.WebDriverError)
                throw err;
            throw new types_1.WebDriverError(types_1.WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED, 'Qwen 提取响应失败', err);
        }
    }
    isValidConversationUrl(url) {
        return url.startsWith('https://chat.qwen.ai/') && url !== 'https://chat.qwen.ai/';
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
    async getAssistantMessageCount() {
        const primary = await this.page.$$(SELECTORS.assistantMessage);
        if (primary.length > 0)
            return primary.length;
        const fallback = await this.page.$$(SELECTORS.responseArea);
        return fallback.length;
    }
    async getInputText() {
        return this.page.evaluate(([selector]) => {
            const el = globalThis.document.querySelector(selector);
            if (!el)
                return '';
            const tag = (el.tagName || '').toUpperCase();
            if (tag === 'TEXTAREA' || tag === 'INPUT')
                return (el.value || '').trim();
            return (el.textContent || '').trim();
        }, [SELECTORS.inputArea]);
    }
    async waitForDispatch(text, beforeCount, timeoutMs) {
        const start = Date.now();
        const normalizedText = text.replace(/\s+/g, ' ').trim();
        while (Date.now() - start < timeoutMs) {
            await this.sleep(200);
            const currentInput = (await this.getInputText()).replace(/\s+/g, ' ').trim();
            const currentCount = await this.getAssistantMessageCount();
            const stopVisible = await this.page
                .waitForSelector(SELECTORS.stopButton, { timeout: 250, state: 'visible' })
                .then(() => true)
                .catch(() => false);
            if (stopVisible || currentCount > beforeCount) {
                return true;
            }
            // 输入框内容发生变化，也视为发送动作已触发
            if (normalizedText && currentInput !== normalizedText) {
                return true;
            }
        }
        const finalInput = (await this.getInputText()).replace(/\s+/g, ' ').trim();
        return normalizedText ? finalInput !== normalizedText : false;
    }
    async tryPrimarySend() {
        try {
            await this.page.waitForSelector(SELECTORS.sendButton, { timeout: 2000, state: 'visible' });
            await this.page.click(SELECTORS.sendButton);
            return;
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
    async fillInputRobustly(text) {
        await this.page.fill(SELECTORS.inputArea, text);
        // 某些 contenteditable 场景下 fill 后不会触发框架监听，补发 input/change 事件
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
    isThinkingPlaceholder(content) {
        const normalized = content.replace(/\s+/g, ' ').trim().toLowerCase();
        if (!normalized)
            return true;
        const exactPlaceholders = new Set([
            '正在思考',
            '思考中',
            'thinking',
            'thinking...',
            'thinking…',
            '正在思考中',
        ]);
        if (exactPlaceholders.has(normalized))
            return true;
        if (/^正在思考[\.。…]*$/.test(content.trim()))
            return true;
        if (/^思考中[\.。…]*$/.test(content.trim()))
            return true;
        return false;
    }
}
exports.QwenDriver = QwenDriver;
//# sourceMappingURL=QwenDriver.js.map