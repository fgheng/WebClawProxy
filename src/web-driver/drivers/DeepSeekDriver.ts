import { Page } from 'playwright';
import { BaseDriver } from './BaseDriver';
import { WebDriverError, WebDriverErrorCode } from '../types';

/**
 * DeepSeek (https://chat.deepseek.com/) 驱动
 *
 * 注意：DeepSeek 支持"深度思考"模式，会输出推理过程。
 * 本驱动的 extractResponse 会只提取最终回答，过滤推理链。
 */
const SELECTORS = {
  loginIndicator: '[class*="user"], [class*="avatar"], .sidebar-user',
  newChatButton: 'button[class*="new"], [class*="new-chat"], a[href="/"]',
  inputArea: 'textarea#chat-input, textarea[placeholder], textarea',
  sendButton: 'button[type="submit"], [class*="send-button"], [aria-label*="发送"]',
  stopButton: [
    'button[aria-label*="停止"]',
    'button[aria-label*="stop"]',
    'button[aria-label*="Stop"]',
    '[class*="stop-btn"]',
    '[class*="stopBtn"]',
    '[class*="pause-btn"]',
    '[class*="_stop_"]',
  ].join(', '),
  responseArea: '.ds-markdown, [class*="ds-markdown"], [class*="markdown-body"]',
  thinkingArea: '[class*="thinking"], [class*="think-content"], [class*="chain-of-thought"]',
};

export class DeepSeekDriver extends BaseDriver {
  constructor(page: Page, options: ConstructorParameters<typeof BaseDriver>[2] = {}) {
    super(page, 'https://chat.deepseek.com/', options);
  }

  /**
   * 检查是否已登录
   *
   * 重要：此方法不主动导航，只检查当前页面状态。
   * 首次检查时如果当前不在 DeepSeek 页面，才会导航到主页。
   * 这样可以避免每次调用都触发页面跳转导致 DeepSeek 弹出新对话框。
   */
  async isLoggedIn(): Promise<boolean> {
    try {
      const currentUrl = this.page.url();

      // 如果当前不在 DeepSeek 域名下，先导航到主页
      if (!currentUrl.includes('chat.deepseek.com')) {
        await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.sleep(2000);
      }

      // 只检查当前页面状态，不再强制导航
      const url = this.page.url();
      if (url.includes('/login') || url.includes('/sign')) {
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
        'DeepSeek 新建对话失败'
      );
    }
  }

  async sendMessage(text: string): Promise<void> {
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
        throw new WebDriverError(
          WebDriverErrorCode.SEND_MESSAGE_FAILED,
          'DeepSeek 发送后未确认投递'
        );
      }
    } catch (err) {
      if (err instanceof WebDriverError) throw err;
      throw new WebDriverError(
        WebDriverErrorCode.SEND_MESSAGE_FAILED,
        'DeepSeek 发送消息失败',
        err as Error
      );
    }
  }

  async extractResponse(): Promise<string> {
    try {
      const allMessages = await this.page.$$('[class*="message"], [class*="chat-message"]');

      const assistantCandidates: any[] = [];
      for (const msg of allMessages) {
        const isAssistant = await msg.evaluate((el: any) => {
          const cls = String(el.className || '').toLowerCase();
          const role =
            (el.getAttribute('data-role') ||
              el.getAttribute('data-message-role') ||
              el.getAttribute('data-author-role') ||
              '').toLowerCase();
          return (
            cls.includes('assistant') ||
            role === 'assistant' ||
            !!el.querySelector('[class*="ds-markdown"], [class*="markdown-body"], [class*="markdown"]')
          );
        });
        if (isAssistant) assistantCandidates.push(msg);
      }

      if (assistantCandidates.length === 0) {
        const responseEls = await this.page.$$(SELECTORS.responseArea);
        assistantCandidates.push(...responseEls);
      }

      if (assistantCandidates.length === 0) {
        throw new WebDriverError(
          WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED,
          'DeepSeek 未找到响应元素'
        );
      }

      for (let i = assistantCandidates.length - 1; i >= 0; i--) {
        const content = await assistantCandidates[i].evaluate((el: any) => {
          const cloned = el.cloneNode(true) as any;
          const thinkEls = cloned.querySelectorAll(
            '[class*="thinking"], [class*="think"], [class*="chain"], details, summary'
          );
          thinkEls.forEach((e: any) => e.remove());

          // 优先提取代码块（JSON 输出最稳定）
          const codeNodes = Array.from(
            cloned.querySelectorAll('pre code, code[class*="language"], pre')
          ) as any[];
          const codeTexts = codeNodes
            .map((n) => (n.textContent || '').trim())
            .filter((t) => t.length > 0);
          if (codeTexts.length > 0) {
            return codeTexts.sort((a, b) => b.length - a.length)[0];
          }

          const mdEl = cloned.querySelector(
            '[class*="ds-markdown"], [class*="markdown"], [class*="content"]'
          );
          const text = (mdEl ? mdEl.textContent : cloned.textContent) || '';
          return text.replace(/\s+/g, ' ').trim();
        });

        if (content) {
          return content;
        }
      }

      throw new WebDriverError(
        WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED,
        'DeepSeek 响应内容为空'
      );
    } catch (err) {
      if (err instanceof WebDriverError) throw err;
      throw new WebDriverError(
        WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED,
        'DeepSeek 提取响应失败',
        err as Error
      );
    }
  }

  isValidConversationUrl(url: string): boolean {
    return (
      url.startsWith('https://chat.deepseek.com/') &&
      url !== 'https://chat.deepseek.com/'
    );
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

  private async getInputText(): Promise<string> {
    return this.page.evaluate(([selector]: [string]) => {
      const el = (globalThis as any).document.querySelector(selector as string) as any;
      if (!el) return '';
      const tag = (el.tagName || '').toUpperCase();
      if (tag === 'TEXTAREA' || tag === 'INPUT') return String(el.value || '').trim();
      return String(el.textContent || '').trim();
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

  private async fillInputRobustly(text: string): Promise<void> {
    await this.page.fill(SELECTORS.inputArea, text);
    await this.page.evaluate(([selector, value]: [string, string]) => {
      const el = (globalThis as any).document.querySelector(selector as string) as any;
      if (!el) return;
      const tag = (el.tagName || '').toUpperCase();
      if (tag === 'TEXTAREA' || tag === 'INPUT') {
        el.value = value;
      } else {
        el.textContent = value;
      }
      el.dispatchEvent(new (globalThis as any).Event('input', { bubbles: true }));
      el.dispatchEvent(new (globalThis as any).Event('change', { bubbles: true }));
    }, [SELECTORS.inputArea, text] as [string, string]);
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
        // ignore and fallback to keyboard
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

  private async waitForDispatch(canonicalText: string, timeoutMs: number): Promise<boolean> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      await this.sleep(200);

      const stopVisible = await this.page
        .waitForSelector(SELECTORS.stopButton, { timeout: 250, state: 'visible' })
        .then(() => true)
        .catch(() => false);
      if (stopVisible) return true;

      const currentCanonical = this.canonicalizeForDispatch(await this.getInputText());
      if (!canonicalText || currentCanonical !== canonicalText) {
        return true;
      }
    }

    const finalCanonical = this.canonicalizeForDispatch(await this.getInputText());
    return !canonicalText || finalCanonical !== canonicalText;
  }
}
