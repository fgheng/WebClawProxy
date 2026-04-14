import { Page } from 'playwright';
import { BaseDriver } from './BaseDriver';
import { WebDriverError, WebDriverErrorCode } from '../types';

const SELECTORS = {
  loginIndicator: '[class*="avatar"], [class*="user"], [class*="profile"]',
  inputArea: 'textarea:not([readonly]):not([aria-hidden="true"]), [contenteditable="true"]:not([aria-hidden="true"])',
  sendButton: 'button[type="submit"], button[class*="send"], button[aria-label*="发送"], button[aria-label*="send"]',
  stopButton: [
    'button[aria-label*="停止"]',
    'button[aria-label*="Stop"]',
    'button[aria-label*="stop"]',
    '[class*="stop"]',
  ].join(', '),
  responseArea: [
    '[data-role="assistant"]',
    '[data-message-role="assistant"]',
    '[data-author-role="assistant"]',
    '[class*="assistant"]',
    '[class*="message-content"]',
    '[class*="markdown"]',
  ].join(', '),
};

export class GLMDriver extends BaseDriver {
  constructor(page: Page, options: ConstructorParameters<typeof BaseDriver>[2] = {}) {
    super(page, 'https://chatglm.cn/', options);
  }

  async isLoggedIn(): Promise<boolean> {
    try {
      await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.sleep(2000);
      const currentUrl = this.page.url().toLowerCase();
      if (currentUrl.includes('/login') || currentUrl.includes('/signin')) {
        return false;
      }
      try {
        await this.page.waitForSelector(SELECTORS.loginIndicator, { timeout: 5000 });
        return true;
      } catch {
        return !currentUrl.includes('/login');
      }
    } catch {
      return false;
    }
  }

  async createNewConversation(): Promise<void> {
    await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    try {
      await this.page.waitForSelector(SELECTORS.inputArea, { timeout: 10000, state: 'visible' });
    } catch {
      throw new WebDriverError(
        WebDriverErrorCode.NEW_CONVERSATION_FAILED,
        'GLM 新建对话失败'
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
          'GLM 发送后未确认投递'
        );
      }
    } catch (err) {
      if (err instanceof WebDriverError) throw err;
      throw new WebDriverError(
        WebDriverErrorCode.SEND_MESSAGE_FAILED,
        'GLM 发送消息失败',
        err as Error
      );
    }
  }

  async extractResponse(): Promise<string> {
    try {
      const responseElements = await this.page.$$(SELECTORS.responseArea);
      if (responseElements.length === 0) {
        throw new WebDriverError(
          WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED,
          'GLM 未找到响应元素'
        );
      }

      for (let i = responseElements.length - 1; i >= 0; i--) {
        const content = await responseElements[i].evaluate((el: any) => {
          const cloned = el.cloneNode(true) as any;
          const thinkEls = cloned.querySelectorAll(
            '[class*="think"], [class*="reason"], [class*="cot"], details, summary'
          );
          thinkEls.forEach((node: any) => node.remove());

          const codeNodes = Array.from(
            cloned.querySelectorAll('pre code, code[class*="language"], pre')
          ) as any[];
          const codeTexts = codeNodes
            .map((n) => (n.textContent || '').trim())
            .filter((t) => t.length > 0);
          if (codeTexts.length > 0) {
            return codeTexts.sort((a, b) => b.length - a.length)[0];
          }

          const text = (cloned.textContent || '').replace(/\s+/g, ' ').trim();
          return text;
        });

        if (content) return content;
      }

      throw new WebDriverError(
        WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED,
        'GLM 响应内容为空'
      );
    } catch (err) {
      if (err instanceof WebDriverError) throw err;
      throw new WebDriverError(
        WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED,
        'GLM 提取响应失败',
        err as Error
      );
    }
  }

  isValidConversationUrl(url: string): boolean {
    return url.startsWith('https://chatglm.cn/') && url !== 'https://chatglm.cn/';
  }

  protected getStopButtonSelector(): string | null {
    return SELECTORS.stopButton;
  }

  protected getResponseAreaSelector(): string | null {
    return SELECTORS.responseArea;
  }

  async navigateToConversation(url: string): Promise<void> {
    if (!this.isValidConversationUrl(url)) {
      throw new WebDriverError(
        WebDriverErrorCode.INVALID_SESSION_URL,
        `无效的对话 URL: ${url}`
      );
    }

    await this.page.goto(url, { waitUntil: 'commit', timeout: 15000 });
    await this.page.waitForSelector(SELECTORS.inputArea, { timeout: 10000, state: 'visible' });
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
