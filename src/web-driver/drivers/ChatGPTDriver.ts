import { Page } from 'playwright';
import { BaseDriver } from './BaseDriver';
import { WebDriverError, WebDriverErrorCode } from '../types';

/**
 * ChatGPT (https://chatgpt.com/) 驱动
 *
 * 选择器说明：
 * - 所有选择器集中在 SELECTORS 对象中，方便 UI 变化时快速修改
 */
const SELECTORS = {
  /** 已登录状态标识（用户头像/菜单按钮） */
  loginIndicator: '[data-testid="profile-button"]',
  /** 新建对话按钮 */
  newChatButton: '[data-testid="create-new-chat-button"]',
  /** 备用新建对话按钮 */
  newChatButtonAlt: 'a[href="/"]',
  /** 消息输入框 */
  inputArea: '#prompt-textarea',
  /** 发送按钮 */
  sendButton: '[data-testid="send-button"]',
  /** 停止生成按钮 */
  stopButton: '[data-testid="stop-button"]',
  /** 最后一条助手消息区域 */
  responseArea: '[data-message-author-role="assistant"]',
  /** 可能出现的弹窗/广告关闭按钮 */
  dialogClose: '[data-testid="close-button"]',
  /** 旁路弹窗（欢迎/活动弹窗） */
  modalOverlay: '[role="dialog"]',
};

export class ChatGPTDriver extends BaseDriver {
  constructor(page: Page, options: ConstructorParameters<typeof BaseDriver>[2] = {}) {
    super(page, 'https://chatgpt.com/', options);
  }

  /**
   * 检查是否已登录
   * 只在当前不在 ChatGPT 页面时才主动导航，避免每次都刷新页面触发弹窗
   */
  async isLoggedIn(): Promise<boolean> {
    try {
      const currentUrl = this.page.url();
      if (!currentUrl.includes('chatgpt.com')) {
        await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.sleep(2000);
      }
      await this.page.waitForSelector(SELECTORS.loginIndicator, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async createNewConversation(): Promise<void> {
    // 统一采用回到主页的方式创建新会话，避免污染已有 session。
    await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.dismissDialogs();

    // 等待输入框出现，确认新对话已创建
    try {
      await this.page.waitForSelector(SELECTORS.inputArea, { timeout: 10000, state: 'visible' });
    } catch {
      throw new WebDriverError(
        WebDriverErrorCode.NEW_CONVERSATION_FAILED,
        'ChatGPT 新建对话失败，输入框未出现'
      );
    }
  }

  async sendMessage(text: string): Promise<void> {
    try {
      await this.page.waitForSelector(SELECTORS.inputArea, { timeout: 10000, state: 'visible' });

      const normalizedText = this.normalizeForInputComparison(text);
      const canonicalText = this.canonicalizeForDispatch(text);
      let dispatched = false;
      let dispatchAnchorUrl = this.page.url();
      this.debugLog('send:start', {
        url: dispatchAnchorUrl,
        textLength: text.length,
        normalizedLength: normalizedText.length,
        canonicalLength: canonicalText.length,
        preview: this.previewText(normalizedText),
      });

      for (let i = 0; i < 3; i++) {
        await this.dismissDialogs();
        await this.clearInputArea();
        await this.page.fill(SELECTORS.inputArea, text);

        const currentInput = await this.getInputText();
        const currentCanonicalInput = this.canonicalizeForDispatch(currentInput);
        const inputMatches = !canonicalText || currentCanonicalInput === canonicalText;
        this.debugLog('send:after_fill', {
          attempt: i + 1,
          inputLength: currentInput.length,
          canonicalInputLength: currentCanonicalInput.length,
          inputMatches,
          preview: this.previewText(currentInput),
        });
        if (!inputMatches) {
          this.debugLog('send:fill_mismatch', {
            attempt: i + 1,
            expectedLength: normalizedText.length,
            actualLength: currentInput.length,
            expectedCanonicalLength: canonicalText.length,
            actualCanonicalLength: currentCanonicalInput.length,
            expectedPreview: this.previewText(normalizedText),
            actualPreview: this.previewText(currentInput),
          });
          await this.sleep(150);
          continue;
        }

        const sendState = await this.waitForSendButtonStateAfterFill(canonicalText, i === 0 ? 2500 : 1500);
        const triggerMethod = await this.triggerSend(sendState);
        this.debugLog('send:triggered', {
          attempt: i + 1,
          triggerMethod,
          sendState,
          anchorUrl: dispatchAnchorUrl,
        });

        dispatched = await this.waitForDispatch(canonicalText, dispatchAnchorUrl, 3200);
        this.debugLog('send:dispatch_result', {
          attempt: i + 1,
          dispatched,
          currentUrl: this.page.url(),
        });
        if (dispatched) break;

        await this.recoverFromUndispatchedMessage();
        dispatchAnchorUrl = this.page.url();
        await this.sleep(200);
      }

      if (!dispatched) {
        this.debugLog('send:failed', {
          finalUrl: this.page.url(),
          finalInputPreview: this.previewText(await this.getInputText()),
        });
        throw new WebDriverError(
          WebDriverErrorCode.SEND_MESSAGE_FAILED,
          'ChatGPT 发送后未确认投递（输入可能未生效）'
        );
      }
    } catch (err) {
      if (err instanceof WebDriverError) throw err;
      throw new WebDriverError(
        WebDriverErrorCode.SEND_MESSAGE_FAILED,
        'ChatGPT 发送消息失败',
        err as Error
      );
    }
  }

  async extractResponse(): Promise<string> {
    try {
      // 获取所有助手消息，取最后一条
      const responseElements = await this.page.$$(SELECTORS.responseArea);

      if (responseElements.length === 0) {
        throw new WebDriverError(
          WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED,
          'ChatGPT 未找到助手响应元素'
        );
      }

      const lastResponse = responseElements[responseElements.length - 1];

      // 提取文本内容，过滤掉思维链（ChatGPT 的思维链通常在 <details> 元素中）
      const content = await lastResponse.evaluate((el: any) => {
        // 移除思维链元素（如果存在）
        const thinkingEls = el.querySelectorAll('[data-testid*="think"], details, summary');
        thinkingEls.forEach((e: any) => e.remove());

        // 获取主要文本内容
        const textEl = el.querySelector('.markdown, .prose, [class*="markdown"]');
        if (textEl) return textEl.textContent?.trim() || '';
        return el.textContent?.trim() || '';
      });

      if (!content) {
        throw new WebDriverError(
          WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED,
          'ChatGPT 响应内容为空'
        );
      }

      return content;
    } catch (err) {
      if (err instanceof WebDriverError) throw err;
      throw new WebDriverError(
        WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED,
        'ChatGPT 提取响应失败',
        err as Error
      );
    }
  }

  isValidConversationUrl(url: string): boolean {
    // ChatGPT 对话链接格式: https://chatgpt.com/c/{id}
    return /^https:\/\/chatgpt\.com\/c\/[\w-]+/.test(url);
  }

  protected getStopButtonSelector(): string | null {
    return SELECTORS.stopButton;
  }

  protected getResponseAreaSelector(): string | null {
    return SELECTORS.responseArea;
  }

  private async getInputText(): Promise<string> {
    return this.page.evaluate(([selector]: [string]) => {
      const el = (globalThis as any).document.querySelector(selector as string);
      if (!el) return '';
      const tag = (el.tagName || '').toUpperCase();
      if (tag === 'TEXTAREA' || tag === 'INPUT') return ((el as any).value || '').replace(/\s+/g, ' ').trim();
      return ((el.textContent || '') as string).replace(/\s+/g, ' ').trim();
    }, [SELECTORS.inputArea] as [string]);
  }

  private async waitForDispatch(
    canonicalText: string,
    beforeUrl: string,
    timeoutMs: number
  ): Promise<boolean> {
    const start = Date.now();
    let rounds = 0;

    while (Date.now() - start < timeoutMs) {
      await this.sleep(200);
      rounds++;

      const currentUrl = this.page.url();
      if (currentUrl && currentUrl !== beforeUrl) {
        this.debugLog('dispatch:url_changed', {
          rounds,
          beforeUrl,
          currentUrl,
        });
        return true;
      }

      const stopVisible = await this.page
        .waitForSelector(SELECTORS.stopButton, { timeout: 250, state: 'visible' })
        .then(() => true)
        .catch(() => false);
      if (stopVisible) {
        this.debugLog('dispatch:stop_visible', { rounds, currentUrl });
        return true;
      }

      const currentInput = await this.getInputText();
      const currentCanonicalInput = this.canonicalizeForDispatch(currentInput);
      if (!canonicalText || currentCanonicalInput !== canonicalText) {
        this.debugLog('dispatch:input_changed', {
          rounds,
          currentUrl,
          currentInputLength: currentInput.length,
          canonicalInputLength: currentCanonicalInput.length,
          currentInputPreview: this.previewText(currentInput),
        });
        return true;
      }
    }

    const finalInput = await this.getInputText();
    const finalCanonicalInput = this.canonicalizeForDispatch(finalInput);
    this.debugLog('dispatch:timeout', {
      beforeUrl,
      currentUrl: this.page.url(),
      finalInputLength: finalInput.length,
      finalCanonicalLength: finalCanonicalInput.length,
      finalInputPreview: this.previewText(finalInput),
    });
    return !canonicalText || finalCanonicalInput !== canonicalText;
  }

  private async waitForSendButtonStateAfterFill(
    canonicalText: string,
    timeoutMs: number
  ): Promise<{ mounted: boolean; ready: boolean }> {
    const start = Date.now();
    let sawMounted = false;
    let rounds = 0;

    while (Date.now() - start < timeoutMs) {
      await this.dismissDialogs();
      rounds++;

      const state = await this.page
        .evaluate(([inputSelector, sendButtonSelector, overlaySelector, stopButtonSelector]: [string, string, string, string]) => {
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
          const overlayVisible = Array.from(doc.querySelectorAll(overlaySelector as string)).some((el) => isVisible(el));
          const stopVisible = Array.from(doc.querySelectorAll(stopButtonSelector as string)).some((el) => isVisible(el));

          const inputText = input
            ? (((input.value ?? input.textContent ?? '') as string).replace(/\s+/g, ' ').trim())
            : '';

          const sendButtonReady = Boolean(
            sendButton &&
            isVisible(sendButton) &&
            !sendButton.disabled &&
            sendButton.getAttribute?.('aria-disabled') !== 'true'
          );

          return {
            inputCanonicalMatches: inputText.replace(/\s+/g, '') === canonicalText,
            sendButtonMounted: Boolean(sendButton),
            sendButtonReady,
            overlayVisible,
            stopVisible,
          };
        }, [SELECTORS.inputArea, SELECTORS.sendButton, SELECTORS.modalOverlay, SELECTORS.stopButton] as [string, string, string, string])
        .catch(() => ({
          inputCanonicalMatches: false,
          sendButtonMounted: false,
          sendButtonReady: false,
          overlayVisible: false,
          stopVisible: false,
        }));

      this.debugLog('send:button_probe', {
        rounds,
        state,
      });

      if (!state.overlayVisible && !state.stopVisible && state.sendButtonReady && state.inputCanonicalMatches) {
        return { mounted: true, ready: true };
      }

      if (!state.inputCanonicalMatches) {
        return { mounted: sawMounted || state.sendButtonMounted, ready: false };
      }

      sawMounted = sawMounted || state.sendButtonMounted;

      // 发送按钮节点已挂载但暂未就绪时，继续等待前端事件绑定稳定。
      if (state.sendButtonMounted || state.overlayVisible) {
        await this.sleep(120);
        continue;
      }

      await this.sleep(120);
    }

    return { mounted: sawMounted, ready: false };
  }

  private async triggerSend(sendState: { mounted: boolean; ready: boolean }): Promise<'button' | 'dom_button' | 'enter'> {
    if (sendState.ready || sendState.mounted) {
      const clickMethod = await this.clickSendButton().catch(() => null);
      if (clickMethod) return clickMethod;
    }

    await this.page.keyboard.press('Enter');
    return 'enter';
  }

  private async clickSendButton(): Promise<'button' | 'dom_button' | null> {
    try {
      await this.page.click(SELECTORS.sendButton, { timeout: 1000 });
      return 'button';
    } catch {
      // 回退到 DOM 原生 click，避免某些覆盖层/动画导致 Playwright click 失败。
    }

    const clicked = await this.page
      .evaluate(([selector]: [string]) => {
        const button = (globalThis as any).document.querySelector(selector as string) as any;
        if (!button) return false;
        if (button.disabled || button.getAttribute?.('aria-disabled') === 'true') return false;
        button.click?.();
        return true;
      }, [SELECTORS.sendButton] as [string])
      .catch(() => false);

    return clicked ? 'dom_button' : null;
  }

  private async clearInputArea(): Promise<void> {
    try {
      await this.page.fill(SELECTORS.inputArea, '');
    } catch {
      // 某些运行态 fill('') 会失败，回退到模拟用户清空。
    }

    const existingText = await this.getInputText();
    if (!existingText) {
      this.debugLog('send:clear_input', { method: 'fill-empty', cleared: true });
      return;
    }

    await this.page.click(SELECTORS.inputArea).catch(() => null);
    await this.page.keyboard.press('Meta+A').catch(() => null);
    await this.page.keyboard.press('Backspace').catch(() => null);
    await this.sleep(80);

    const finalText = await this.getInputText();
    this.debugLog('send:clear_input', {
      method: 'fill-empty+select-all',
      beforeLength: existingText.length,
      afterLength: finalText.length,
      cleared: !finalText,
      preview: this.previewText(finalText),
    });
  }

  private async recoverFromUndispatchedMessage(): Promise<void> {
    this.debugLog('send:recover:start', { url: this.page.url() });
    await this.dismissDialogs();
    await this.page.waitForSelector(SELECTORS.inputArea, { timeout: 3000, state: 'visible' }).catch(() => null);
    await this.page.click(SELECTORS.inputArea).catch(() => null);
    await this.sleep(180);
    this.debugLog('send:recover:end', {
      url: this.page.url(),
      inputPreview: this.previewText(await this.getInputText()),
    });
  }

  /**
   * 关闭可能存在的弹窗/广告
   */
  private async dismissDialogs(): Promise<void> {
    try {
      const closeBtn = await this.page.$(SELECTORS.dialogClose);
      if (closeBtn) {
        await closeBtn.click();
        await this.sleep(500);
      }
    } catch {
      // 忽略关闭失败
    }

    // 按 Escape 键关闭弹窗
    try {
      await this.page.keyboard.press('Escape');
      await this.sleep(300);
    } catch {
      // 忽略
    }
  }

  private previewText(text: string, maxLength = 120): string {
    if (!text) return '';
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }

  private normalizeForInputComparison(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  private canonicalizeForDispatch(text: string): string {
    return text.replace(/\s+/g, '').trim();
  }

  private debugLog(stage: string, payload: Record<string, unknown>): void {
    try {
      console.log(`[ChatGPTDriver][${stage}] ${JSON.stringify(payload)}`);
    } catch {
      console.log(`[ChatGPTDriver][${stage}]`, payload);
    }
  }
}
