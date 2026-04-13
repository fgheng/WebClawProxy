import { Page } from 'playwright';
import { BaseDriver } from './BaseDriver';
import { WebDriverError, WebDriverErrorCode } from '../types';

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
  inputArea: 'textarea:not([readonly]):not([aria-hidden="true"]), [contenteditable="true"]:not([aria-hidden="true"])',
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
};

export class QwenDriver extends BaseDriver {
  private lastAssistantResponseText = '';
  private pendingResponseBaseCount = 0;

  constructor(page: Page, options: ConstructorParameters<typeof BaseDriver>[2] = {}) {
    super(page, 'https://chat.qwen.ai/', options);
  }

  /**
   * 检查是否已登录
   * 只在当前不在 Qwen 页面时才主动导航，避免重复刷新触发弹窗
   */
  async isLoggedIn(): Promise<boolean> {
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
      } catch {
        return !url.includes('/login');
      }
    } catch {
      return false;
    }
  }

  async createNewConversation(): Promise<void> {
    // 统一采用回到主页的方式创建新会话，避免污染已有 session。
    await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.dismissDialogs();

    try {
      await this.page.waitForSelector(SELECTORS.inputArea, { timeout: 10000, state: 'visible' });
    } catch {
      throw new WebDriverError(
        WebDriverErrorCode.NEW_CONVERSATION_FAILED,
        'Qwen 新建对话失败'
      );
    }
  }

  async navigateToConversation(url: string): Promise<void> {
    if (!this.isValidConversationUrl(url)) {
      throw new WebDriverError(
        WebDriverErrorCode.INVALID_SESSION_URL,
        `无效的对话 URL: ${url}`
      );
    }

    // Qwen 是偏 SPA 的页面，使用更轻的导航等待条件，避免卡在 domcontentloaded。
    await this.page.goto(url, { waitUntil: 'commit', timeout: 15000 });
    await this.page.waitForSelector(SELECTORS.inputArea, { timeout: 10000, state: 'visible' });
  }

  async sendMessage(text: string): Promise<void> {
    try {
      await this.page.waitForSelector(SELECTORS.inputArea, { timeout: 10000, state: 'visible' });

      const beforeCount = await this.getAssistantMessageCount();
      this.pendingResponseBaseCount = beforeCount;
      const canonicalText = this.canonicalizeForDispatch(text);

      await this.clearInputArea();
      await this.fillInputRobustly(text);
      await this.sleep(200);

      // 首轮发送尝试：优先按钮，必要时回退 Enter
      const sendState = await this.waitForSendButtonStateAfterFill(canonicalText, 2000);
      await this.tryPrimarySend(sendState);

      let dispatched = await this.waitForDispatch(canonicalText, beforeCount, 2500);

      // 二次兜底：Ctrl/Cmd+Enter，再确认一次
      if (!dispatched) {
        await this.tryFallbackSend();
        dispatched = await this.waitForDispatch(canonicalText, beforeCount, 2000);
      }

      // 注意：Qwen 某些版本发送后输入框不会立即清空，不能在此直接判失败
      if (!dispatched) {
        console.warn('[QwenDriver] dispatch confirmation not observed immediately, continue to response waiting');
      }
    } catch (err) {
      if (err instanceof WebDriverError) throw err;
      throw new WebDriverError(
        WebDriverErrorCode.SEND_MESSAGE_FAILED,
        'Qwen 发送消息失败',
        err as Error
      );
    }
  }

  async extractResponse(): Promise<string> {
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
          const content = await candidate.evaluate((el: any) => {
            // 过滤思维链（通常在 details 或特定 class 中）
            const thinkEls = el.querySelectorAll('details, [class*="think"], [class*="reasoning"]');
            thinkEls.forEach((e: any) => e.remove());

            // 优先取 markdown 渲染区域
            const mdEl = el.querySelector('[class*="markdown"], [class*="content"]');
            const raw = mdEl ? mdEl.textContent || '' : el.textContent || '';
            return raw.replace(/\s+/g, ' ').trim();
          });

          if (!content) continue;
          if (this.isThinkingPlaceholder(content)) continue;
          picked = content;
          break;
        }

        // 还没产出最终回复，继续等
        if (!picked) {
          await this.sleep(400);
          continue;
        }

        // 结构化内容（JSON）未闭合时继续等待，避免截断文本提前返回
        if (this.isLikelyIncompleteStructuredText(picked)) {
          await this.sleep(350);
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

      throw new WebDriverError(
        WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED,
        'Qwen 尚未产出可用最终回复（可能仍在思考或发送未生效）'
      );
    } catch (err) {
      if (err instanceof WebDriverError) throw err;
      throw new WebDriverError(
        WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED,
        'Qwen 提取响应失败',
        err as Error
      );
    }
  }

  isValidConversationUrl(url: string): boolean {
    return url.startsWith('https://chat.qwen.ai/') && url !== 'https://chat.qwen.ai/';
  }

  protected getStopButtonSelector(): string | null {
    return SELECTORS.stopButton;
  }

  protected getResponseAreaSelector(): string | null {
    return SELECTORS.responseArea;
  }

  private async dismissDialogs(): Promise<void> {
    try {
      await this.page.keyboard.press('Escape');
      await this.sleep(300);
    } catch {
      // 忽略
    }
  }

  private async getAssistantMessageCount(): Promise<number> {
    const primary = await this.page.$$(SELECTORS.assistantMessage);
    if (primary.length > 0) return primary.length;
    const fallback = await this.page.$$(SELECTORS.responseArea);
    return fallback.length;
  }

  private async getInputText(): Promise<string> {
    return this.page.evaluate(([selector]: [string]) => {
      const el = (globalThis as any).document.querySelector(selector as string);
      if (!el) return '';
      const tag = (el.tagName || '').toUpperCase();
      if (tag === 'TEXTAREA' || tag === 'INPUT') return (el.value || '').trim();
      return (el.textContent || '').trim();
    }, [SELECTORS.inputArea] as [string]);
  }

  private canonicalizeForDispatch(text: string): string {
    return text.replace(/\s+/g, '').trim();
  }

  private async clearInputArea(): Promise<void> {
    try {
      await this.page.fill(SELECTORS.inputArea, '');
    } catch {
      // ignore
    }

    const remaining = await this.getInputText();
    if (!remaining) return;

    await this.page.click(SELECTORS.inputArea).catch(() => null);
    await this.page.keyboard.press('Meta+A').catch(() => null);
    await this.page.keyboard.press('Backspace').catch(() => null);
    await this.sleep(80);
  }

  private async waitForDispatch(canonicalText: string, beforeCount: number, timeoutMs: number): Promise<boolean> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      await this.sleep(200);

      const currentInput = this.canonicalizeForDispatch(await this.getInputText());
      const currentCount = await this.getAssistantMessageCount();
      const stopVisible = await this.page
        .waitForSelector(SELECTORS.stopButton, { timeout: 250, state: 'visible' })
        .then(() => true)
        .catch(() => false);

      if (stopVisible || currentCount > beforeCount) {
        return true;
      }

      // 输入框内容发生变化，也视为发送动作已触发
      if (canonicalText && currentInput !== canonicalText) {
        return true;
      }
    }

    const finalInput = this.canonicalizeForDispatch(await this.getInputText());
    return canonicalText ? finalInput !== canonicalText : false;
  }

  private async waitForSendButtonStateAfterFill(
    canonicalText: string,
    timeoutMs: number
  ): Promise<{ mounted: boolean; ready: boolean }> {
    const start = Date.now();
    let sawMounted = false;

    while (Date.now() - start < timeoutMs) {
      const state = await this.page
        .evaluate(([inputSelector, sendButtonSelector, stopButtonSelector]: [string, string, string]) => {
          const doc = (globalThis as any).document;
          const getStyle = (globalThis as any).getComputedStyle;
          const isVisible = (el: any) => {
            if (!el) return false;
            const style = getStyle?.(el);
            const rect = el.getBoundingClientRect?.();
            return !style || (
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              (rect ? rect.width > 0 && rect.height > 0 : true)
            );
          };

          const input = doc.querySelector(inputSelector as string) as any;
          const sendButton = doc.querySelector(sendButtonSelector as string) as any;
          const stopButton = doc.querySelector(stopButtonSelector as string) as any;
          const inputText = input ? String(input.value ?? input.textContent ?? '').replace(/\s+/g, '').trim() : '';

          return {
            inputCanonicalMatches: inputText === canonicalText,
            sendButtonMounted: Boolean(sendButton),
            sendButtonReady: Boolean(
              sendButton &&
              isVisible(sendButton) &&
              !sendButton.disabled &&
              sendButton.getAttribute?.('aria-disabled') !== 'true'
            ),
            stopVisible: isVisible(stopButton),
          };
        }, [SELECTORS.inputArea, SELECTORS.sendButton, SELECTORS.stopButton] as [string, string, string])
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

  private async tryPrimarySend(sendState: { mounted: boolean; ready: boolean }): Promise<void> {
    if (sendState.ready || sendState.mounted) {
      try {
        await this.page.click(SELECTORS.sendButton, { timeout: 1000 });
        return;
      } catch {
        // ignore
      }
    }

    try {
      await this.page.keyboard.press('Enter');
    } catch {
      // ignore
    }
  }

  private async tryFallbackSend(): Promise<void> {
    try {
      await this.page.keyboard.press('Control+Enter');
    } catch {
      // ignore
    }

    try {
      await this.page.keyboard.press('Meta+Enter');
    } catch {
      // ignore
    }

    try {
      await this.page.keyboard.press('Enter');
    } catch {
      // ignore
    }
  }

  private async fillInputRobustly(text: string): Promise<void> {
    await this.page.fill(SELECTORS.inputArea, text);

    // 某些 contenteditable 场景下 fill 后不会触发框架监听，补发 input/change 事件
    await this.page.evaluate(([selector, value]: [string, string]) => {
      const el = (globalThis as any).document.querySelector(selector as string);
      if (!el) return;
      const tag = (el.tagName || '').toUpperCase();
      if (tag === 'TEXTAREA' || tag === 'INPUT') {
        (el as any).value = value;
      } else {
        (el as any).textContent = value;
      }
      el.dispatchEvent(new (globalThis as any).Event('input', { bubbles: true }));
      el.dispatchEvent(new (globalThis as any).Event('change', { bubbles: true }));
    }, [SELECTORS.inputArea, text] as [string, string]);
  }

  private isThinkingPlaceholder(content: string): boolean {
    const normalized = content.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!normalized) return true;

    const exactPlaceholders = new Set([
      '正在思考',
      '思考中',
      'thinking',
      'thinking...',
      'thinking…',
      '正在思考中',
    ]);

    if (exactPlaceholders.has(normalized)) return true;
    if (/^正在思考[\.。…]*$/.test(content.trim())) return true;
    if (/^思考中[\.。…]*$/.test(content.trim())) return true;
    return false;
  }

  private isLikelyIncompleteStructuredText(content: string): boolean {
    const text = content.trim();
    if (!text) return false;

    // 仅在看起来像 JSON 的场景生效，避免影响普通自然语言回复
    if (!(text.startsWith('{') || text.startsWith('['))) {
      return false;
    }

    let stack: string[] = [];
    let inString = false;
    let quote = '';
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === quote) {
          inString = false;
          quote = '';
        }
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = true;
        quote = ch;
        continue;
      }

      if (ch === '{' || ch === '[') {
        stack.push(ch);
        continue;
      }

      if (ch === '}' || ch === ']') {
        const top = stack[stack.length - 1];
        if ((ch === '}' && top === '{') || (ch === ']' && top === '[')) {
          stack.pop();
        } else {
          return true;
        }
      }
    }

    // 字符串未闭合或括号未闭合，认为仍在输出中
    return inString || stack.length > 0;
  }
}
