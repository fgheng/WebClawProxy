import { Page } from 'playwright';
import { BaseDriver } from './BaseDriver';
import { WebDriverError, WebDriverErrorCode } from '../types';

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

  // 响应区域：使用更精确的 Kimi 特有 class，缩小匹配范围
  // 优先匹配带有 data-role 属性或 assistant 语义的容器
  responseArea: [
    '[data-role="assistant"]',
    '[data-message-role="assistant"]',
    '[class*="kimi-message"][class*="assistant"]',
    '[class*="chat-message"][class*="assistant"]',
    // Kimi markdown 渲染容器
    '[class*="markdown-body"]',
    '[class*="message-content"][class*="assistant"]',
  ].join(', '),
};

export class KimiDriver extends BaseDriver {
  constructor(page: Page, options: ConstructorParameters<typeof BaseDriver>[2] = {}) {
    super(page, 'https://www.kimi.com/', options);
  }

  async isLoggedIn(): Promise<boolean> {
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
      } catch {
        return !currentUrl.includes('/login');
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
      // 导航到主页
    }

    if (!created) {
      await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    try {
      await this.page.waitForSelector(SELECTORS.inputArea, { timeout: 10000, state: 'visible' });
    } catch {
      throw new WebDriverError(
        WebDriverErrorCode.NEW_CONVERSATION_FAILED,
        'Kimi 新建对话失败'
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
        'Kimi 发送消息失败',
        err as Error
      );
    }
  }

  async extractResponse(): Promise<string> {
    try {
      const candidates: any[] = [];

      // 1) 语义化 assistant 节点（优先）
      const semanticAssistant = await this.page.$$(
        '[data-role="assistant"], [data-message-role="assistant"], [data-author-role="assistant"]'
      );
      candidates.push(...semanticAssistant);

      // 2) 备用：所有可能的消息节点，筛选 assistant 特征
      if (candidates.length === 0) {
        const allMessages = await this.page.$$(
          '[class*="message"], [class*="chat-message"], [class*="segment"], [class*="item"]'
        );
        for (const msg of allMessages) {
          const isAssistant = await msg.evaluate((el: any) => {
            const cls = String(el.className || '').toLowerCase();
            const role =
              (el.getAttribute('data-role') ||
                el.getAttribute('data-message-role') ||
                el.getAttribute('data-author-role') ||
                '').toLowerCase();
            return (
              role === 'assistant' ||
              cls.includes('assistant') ||
              Boolean(el.querySelector('[class*="markdown"], [class*="message-content"]'))
            );
          });
          if (isAssistant) candidates.push(msg);
        }
      }

      // 3) 兜底：responseArea 命中节点
      if (candidates.length === 0) {
        const responseElements = await this.page.$$(SELECTORS.responseArea);
        candidates.push(...responseElements);
      }

      if (candidates.length === 0) {
        throw new WebDriverError(
          WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED,
          'Kimi 未找到响应元素'
        );
      }

      // 从后往前找最后一个非空响应
      for (let i = candidates.length - 1; i >= 0; i--) {
        const content = await candidates[i].evaluate((el: any) => {
          // 在 clone 上移除思维链，避免污染原页面
          const cloned = el.cloneNode(true) as any;
          const thinkEls = cloned.querySelectorAll(
            '[class*="think"], [class*="reason"], [class*="cot"], details, summary'
          );
          thinkEls.forEach((e: any) => e.remove());

          // 优先取代码块（Deep/JSON 场景更稳定）
          const codeNodes = Array.from(
            cloned.querySelectorAll('pre code, code[class*="language"], pre')
          ) as any[];
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

        if (content) return content;
      }

      throw new WebDriverError(
        WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED,
        'Kimi 响应内容为空'
      );
    } catch (err) {
      if (err instanceof WebDriverError) throw err;
      throw new WebDriverError(
        WebDriverErrorCode.RESPONSE_EXTRACTION_FAILED,
        'Kimi 提取响应失败',
        err as Error
      );
    }
  }

  isValidConversationUrl(url: string): boolean {
    return url.startsWith('https://www.kimi.com/') && url !== 'https://www.kimi.com/';
  }

  protected getStopButtonSelector(): string | null {
    // Kimi 的“停止”按钮样式波动较大，易误判导致等待卡住
    // 这里禁用 stop 策略，统一走内容稳定性检测
    return null;
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
