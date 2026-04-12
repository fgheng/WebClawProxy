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
}
