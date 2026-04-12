import { Page } from 'playwright';
import {
  IWebDriver,
  WebDriverError,
  WebDriverErrorCode,
} from '../types';

/**
 * Web 驱动抽象基类
 * 每个网站驱动继承自该基类，实现特定网站的选择器和行为
 * 基类提供通用逻辑：多重回复检测策略、导航等
 */
export abstract class BaseDriver implements IWebDriver {
  protected page: Page;
  protected baseUrl: string;
  protected responseTimeoutMs: number;
  protected stabilityCheckIntervalMs: number;
  protected stabilityCheckCount: number;

  constructor(
    page: Page,
    baseUrl: string,
    options: {
      responseTimeoutMs?: number;
      stabilityCheckIntervalMs?: number;
      stabilityCheckCount?: number;
    } = {}
  ) {
    this.page = page;
    this.baseUrl = baseUrl;
    this.responseTimeoutMs = options.responseTimeoutMs ?? 120000;
    this.stabilityCheckIntervalMs = options.stabilityCheckIntervalMs ?? 500;
    this.stabilityCheckCount = options.stabilityCheckCount ?? 3;
  }

  // ============================
  // 子类必须实现的抽象方法
  // ============================

  /** 判断是否已登录 */
  abstract isLoggedIn(): Promise<boolean>;

  /** 点击新建对话按钮 */
  abstract createNewConversation(): Promise<void>;

  /** 向对话框填入内容并发送 */
  abstract sendMessage(text: string): Promise<void>;

  /** 提取模型的最终回复内容（不含思维链） */
  abstract extractResponse(): Promise<string>;

  /** 判断指定的对话 URL 是否有效 */
  abstract isValidConversationUrl(url: string): boolean;

  // ============================
  // 通用实现
  // ============================

  /** 获取当前对话的 URL */
  async getConversationUrl(): Promise<string> {
    return this.page.url();
  }

  /** 跳转到指定对话 URL */
  async navigateToConversation(url: string): Promise<void> {
    if (!this.isValidConversationUrl(url)) {
      throw new WebDriverError(
        WebDriverErrorCode.INVALID_SESSION_URL,
        `无效的对话 URL: ${url}`
      );
    }
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  /**
   * 等待模型回复完成 - 多重检测策略
   *
   * 策略说明：
   * - 优先使用「停止按钮消失」检测（准确性高，DeepSeek 生成时有明显的停止按钮）
   * - 如果停止按钮检测成功，追加一个小等待（500ms）确保 DOM 已最终刷新
   * - 如果停止按钮检测不可用（返回 null selector），fallback 到「内容稳定性」检测
   * - 两种检测方式都会在超时时抛出错误
   */
  async waitForResponse(): Promise<void> {
    const timeout = this.responseTimeoutMs;
    const stopSelector = this.getStopButtonSelector();
    const responseSelector = this.getResponseAreaSelector();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new WebDriverError(
            WebDriverErrorCode.RESPONSE_TIMEOUT,
            `等待模型响应超时（${timeout}ms）`
          )
        );
      }, timeout);
    });

    try {
      if (stopSelector) {
        // 策略 1：等待停止按钮完整生命周期（出现 -> 消失）
        // 若停止按钮一直未出现，不能直接判定完成，必须回退到内容稳定检测
        const stopLifecycleDetected = await Promise.race([
          timeoutPromise,
          this.waitBySendButtonRestore(),
        ]);

        if (stopLifecycleDetected) {
          // 停止按钮消失后额外等待 500ms，确保最后一帧内容已写入 DOM
          await this.sleep(500);
          return;
        }

        if (responseSelector) {
          await Promise.race([
            timeoutPromise,
            this.waitByContentStability(),
          ]);
          return;
        }

        await this.sleep(5000);
        return;
      }

      if (responseSelector) {
        // 策略 2（fallback）：内容稳定性检测
        await Promise.race([
          timeoutPromise,
          this.waitByContentStability(),
        ]);
      } else {
        // 策略 3：没有任何可用检测方式，等待固定时间
        await this.sleep(5000);
      }
    } catch (err) {
      if (err instanceof WebDriverError) throw err;
      throw new WebDriverError(
        WebDriverErrorCode.RESPONSE_TIMEOUT,
        '等待模型响应时发生错误',
        err as Error
      );
    }
  }

  /**
   * 检测策略 1：发送按钮状态检测
   * 等待"停止"按钮消失（即发送按钮恢复）
   * 注意：需要先等待停止按钮出现，再等待其消失，避免误判
   */
  protected async waitBySendButtonRestore(): Promise<boolean> {
    const stopSelector = this.getStopButtonSelector();
    if (!stopSelector) return false;

    // 先等待停止按钮出现：如果一直没出现，说明可能是平台没有 stop 按钮，交给内容稳定策略处理
    const stopAppearTimeout = Math.min(this.responseTimeoutMs, 20000);
    try {
      await this.page.waitForSelector(stopSelector, {
        timeout: stopAppearTimeout,
        state: 'visible',
      });
    } catch {
      return false;
    }

    // 再等待停止按钮消失，表示生成完成
    await this.page.waitForSelector(stopSelector, {
      state: 'hidden',
      timeout: this.responseTimeoutMs,
    });

    // 防抖：确认停止按钮在短时间内没有再次出现
    await this.sleep(800);
    const stillVisible = await this.page.$(stopSelector);
    if (stillVisible) {
      await this.page.waitForSelector(stopSelector, {
        state: 'hidden',
        timeout: this.responseTimeoutMs,
      });
    }

    return true;
  }

  /**
   * 检测策略 2：内容稳定性检测
   * 每隔 stabilityCheckIntervalMs 检查输出内容，
   * 连续 stabilityCheckCount 次内容相同则认为完成
   *
   * 修复要点：
   * 1. 先等待内容「出现且非空」（确认模型已开始输出），再做稳定性计数
   * 2. 连续稳定计数间隔改为 1500ms（原来 500ms 太短，模型刚开始输出容易误判）
   * 3. 内容为空时重置计数，不允许空内容触发稳定判定
   * 4. 最少等待 minWaitMs，防止极端情况下过早退出
   */
  protected async waitByContentStability(): Promise<void> {
    const responseSelector = this.getResponseAreaSelector();
    if (!responseSelector) return;

    // Step 1: 先等待响应区域出现
    try {
      await this.page.waitForSelector(responseSelector, {
        timeout: 15000,
        state: 'visible',
      });
    } catch {
      await this.sleep(3000);
    }

    // Step 2: 等待内容发生“首个变化”（视为本轮回复开始）
    // 说明：在某些站点，响应区域里会先有上一轮内容；必须先观察到变化，避免误判为本轮已完成
    const startWait = Date.now();
    let baselineContent = '';
    let lastContent = '';
    let hasObservedChange = false;

    try {
      baselineContent = await this.page.evaluate(
        ([sel]: [string]) => {
          const nodes = (globalThis as any).document.querySelectorAll(sel as string);
          const el = nodes.length > 0 ? nodes[nodes.length - 1] : null;
          return el ? (el.textContent || '').trim() : '';
        },
        [responseSelector] as [string]
      );
      lastContent = baselineContent;
    } catch {
      baselineContent = '';
      lastContent = '';
    }

    while (Date.now() - startWait < 30000) {
      await this.sleep(500);
      try {
        const current = await this.page.evaluate(
          ([sel]: [string]) => {
            const nodes = (globalThis as any).document.querySelectorAll(sel as string);
            const el = nodes.length > 0 ? nodes[nodes.length - 1] : null;
            return el ? (el.textContent || '').trim() : '';
          },
          [responseSelector] as [string]
        );

        if (current.length > 0 && current !== baselineContent) {
          hasObservedChange = true;
          lastContent = current;
          break;
        }
      } catch {
        // 继续等待
      }
    }

    if (!hasObservedChange) {
      throw new WebDriverError(
        WebDriverErrorCode.RESPONSE_TIMEOUT,
        '未观察到模型开始输出新响应'
      );
    }

    // Step 3: 稳定性计数（间隔 1500ms，连续 3 次相同即认为完成）
    // 同时要求内容长度 > 0，防止空内容误判
    const checkInterval = Math.max(this.stabilityCheckIntervalMs, 1500);
    let stableCount = 0;

    while (stableCount < this.stabilityCheckCount) {
      await this.sleep(checkInterval);

      let currentContent = '';
      try {
        currentContent = await this.page.evaluate(
          ([selector]: [string]) => {
            const nodes = (globalThis as any).document.querySelectorAll(selector as string);
            const el = nodes.length > 0 ? nodes[nodes.length - 1] : null;
            return el ? (el.textContent || '').trim() : '';
          },
          [responseSelector] as [string]
        );
      } catch {
        // 页面可能在导航，继续等待
        stableCount = 0;
        continue;
      }

      if (currentContent.length > 0 && currentContent === lastContent) {
        stableCount++;
      } else {
        // 内容变化或内容为空 → 重置计数
        stableCount = 0;
        lastContent = currentContent;
      }
    }
  }

  // ============================
  // 子类可覆盖的钩子方法
  // ============================

  /** 返回停止按钮的 CSS 选择器，子类如果没有停止按钮可返回 null */
  protected getStopButtonSelector(): string | null {
    return null;
  }

  /** 返回响应区域的 CSS 选择器，用于内容稳定性检测 */
  protected getResponseAreaSelector(): string | null {
    return null;
  }

  // ============================
  // 工具方法
  // ============================

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 填充文本到输入框（支持大段文本，使用 clipboard 方式避免速度慢）
   */
  protected async fillTextInput(selector: string, text: string): Promise<void> {
    await this.page.waitForSelector(selector, { state: 'visible', timeout: 10000 });
    await this.page.click(selector);

    // 先清空
    await this.page.keyboard.press('Control+A');
    await this.page.keyboard.press('Delete');

    // 使用 evaluate 填充（速度快，在浏览器端执行）
    // 使用数组参数避免 TS 编译时的 DOM 类型问题
    await this.page.evaluate(
      ([sel, content]: [string, string]) => {
        // eslint-disable-next-line no-undef
        const doc = (globalThis as any).document;
        const el = doc.querySelector(sel as string);
        if (el) {
          const tag: string = el.tagName ? el.tagName.toUpperCase() : '';
          if (tag === 'TEXTAREA' || tag === 'INPUT') {
            el.value = content;
            el.dispatchEvent(new (globalThis as any).Event('input', { bubbles: true }));
            el.dispatchEvent(new (globalThis as any).Event('change', { bubbles: true }));
          } else {
            el.textContent = content;
            el.dispatchEvent(new (globalThis as any).Event('input', { bubbles: true }));
          }
        }
      },
      [selector, text] as [string, string]
    );
  }
}
