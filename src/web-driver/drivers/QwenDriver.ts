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
  inputArea: 'textarea, [contenteditable="true"]',
  sendButton: 'button[class*="send"], button[type="submit"]',

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
      } catch {
        continue;
      }
    }

    if (!created) {
      // 直接导航到主页作为新建对话
      await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    try {
      await this.page.waitForSelector(SELECTORS.inputArea, { timeout: 10000, state: 'visible' });
    } catch {
      throw new WebDriverError(
        WebDriverErrorCode.NEW_CONVERSATION_FAILED,
        'Qwen 新建对话失败'
      );
    }
  }

  async sendMessage(text: string): Promise<void> {
    try {
      await this.page.waitForSelector(SELECTORS.inputArea, { timeout: 10000, state: 'visible' });
      await this.page.fill(SELECTORS.inputArea, text);
      await this.sleep(300);

      // 尝试点击发送按钮
      try {
        await this.page.waitForSelector(SELECTORS.sendButton, { timeout: 3000, state: 'visible' });
        await this.page.click(SELECTORS.sendButton);
      } catch {
        // 备用：按 Enter 发送
        await this.page.keyboard.press('Enter');
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
      // 优先通过 data-role 属性精确定位助手消息（最可靠）
      let responseElements = await this.page.$$(
        '[data-role="assistant"], [data-message-role="assistant"], [data-author-role="assistant"]'
      );

      // 备用：通过 responseArea 选择器
      if (responseElements.length === 0) {
        responseElements = await this.page.$$(SELECTORS.responseArea);
      }

      if (responseElements.length === 0) {
        throw new WebDriverError(
          WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED,
          'Qwen 未找到响应元素'
        );
      }

      const lastResponse = responseElements[responseElements.length - 1];
      const content = await lastResponse.evaluate((el: any) => {
        // 过滤思维链（通常在 details 或特定 class 中）
        const thinkEls = el.querySelectorAll('details, [class*="think"], [class*="reasoning"]');
        thinkEls.forEach((e: any) => e.remove());

        // 优先取 markdown 渲染区域
        const mdEl = el.querySelector('[class*="markdown"], [class*="content"]');
        if (mdEl) return mdEl.textContent?.trim() || '';
        return el.textContent?.trim() || '';
      });

      if (!content) {
        throw new WebDriverError(
          WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED,
          'Qwen 响应内容为空'
        );
      }

      return content;
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
}
