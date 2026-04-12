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

      // 必须检测到明确账号态 UI，才判定为已登录
      await this.page.waitForSelector(SELECTORS.loginIndicator, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async createNewConversation(): Promise<void> {
    await this.dismissDialogs();

    let created = false;
    try {
      await this.page.waitForSelector(SELECTORS.newChatButton, { timeout: 5000 });
      await this.page.click(SELECTORS.newChatButton);
      created = true;
    } catch {
      // 直接导航到主页
    }

    if (!created) {
      await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

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
      await this.page.fill(SELECTORS.inputArea, text);
      await this.sleep(300);

      try {
        await this.page.waitForSelector(SELECTORS.sendButton, { timeout: 3000, state: 'visible' });
        await this.page.click(SELECTORS.sendButton);
      } catch {
        await this.page.keyboard.press('Enter');
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

      let lastAssistantEl = null;
      for (const msg of allMessages) {
        const isAssistant = await msg.evaluate((el: any) => {
          return (
            el.className.includes('assistant') ||
            el.getAttribute('data-role') === 'assistant' ||
            !!(el.querySelectorAll('[class*="ds-markdown"], [class*="markdown-body"]').length)
          );
        });
        if (isAssistant) {
          lastAssistantEl = msg;
        }
      }

      if (!lastAssistantEl) {
        const responseEls = await this.page.$$(SELECTORS.responseArea);
        if (responseEls.length > 0) {
          lastAssistantEl = responseEls[responseEls.length - 1];
        }
      }

      if (!lastAssistantEl) {
        throw new WebDriverError(
          WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED,
          'DeepSeek 未找到响应元素'
        );
      }

      const content = await lastAssistantEl.evaluate((el: any) => {
        const thinkEls = el.querySelectorAll(
          '[class*="thinking"], [class*="think"], [class*="chain"], details, summary'
        );
        thinkEls.forEach((e: any) => e.remove());

        const mdEl = el.querySelector('[class*="ds-markdown"], [class*="markdown"], [class*="content"]');
        if (mdEl) return mdEl.textContent?.trim() || '';
        return el.textContent?.trim() || '';
      });

      if (!content) {
        throw new WebDriverError(
          WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED,
          'DeepSeek 响应内容为空'
        );
      }

      return content;
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
}
