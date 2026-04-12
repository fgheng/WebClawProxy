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
    // 先尝试关闭可能存在的弹窗
    await this.dismissDialogs();

    // 尝试点击新建对话按钮
    try {
      await this.page.waitForSelector(SELECTORS.newChatButton, { timeout: 5000 });
      await this.page.click(SELECTORS.newChatButton);
    } catch {
      // 备用方案：直接导航到主页
      await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

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

      const normalizedText = text.replace(/\s+/g, ' ').trim();
      let dispatched = false;

      for (let i = 0; i < 3; i++) {
        await this.page.fill(SELECTORS.inputArea, text);

        const currentInput = await this.getInputText();
        if (normalizedText && currentInput !== normalizedText) {
          await this.sleep(150);
          continue;
        }

        try {
          await this.page.waitForSelector(SELECTORS.sendButton, { timeout: 3000, state: 'visible' });
          await this.page.click(SELECTORS.sendButton);
        } catch {
          await this.page.keyboard.press('Enter');
        }

        dispatched = await this.waitForDispatch(normalizedText, 1800);
        if (dispatched) break;

        await this.sleep(200);
      }

      if (!dispatched) {
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

  private async waitForDispatch(normalizedText: string, timeoutMs: number): Promise<boolean> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      await this.sleep(200);

      const stopVisible = await this.page
        .waitForSelector(SELECTORS.stopButton, { timeout: 250, state: 'visible' })
        .then(() => true)
        .catch(() => false);
      if (stopVisible) return true;

      const currentInput = await this.getInputText();
      if (!normalizedText || currentInput !== normalizedText) {
        return true;
      }
    }

    const finalInput = await this.getInputText();
    return !normalizedText || finalInput !== normalizedText;
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
}
