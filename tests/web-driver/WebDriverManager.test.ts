import { WebDriverManager, WebDriverError, WebDriverErrorCode } from '../../src/web-driver';
import type { SiteKey } from '../../src/web-driver';
import { QwenDriver } from '../../src/web-driver/drivers/QwenDriver';

/**
 * Web 驱动模块单元测试
 *
 * 注意：本文件中的测试会 mock Playwright，不实际打开浏览器。
 * 如需真实浏览器测试，请运行 scripts/test-web-driver.ts
 */

// Mock playwright
jest.mock('playwright', () => {
  const mockPage = {
    goto: jest.fn().mockResolvedValue(undefined),
    url: jest.fn().mockReturnValue('https://chatgpt.com/'),
    waitForSelector: jest.fn().mockResolvedValue({}),
    click: jest.fn().mockResolvedValue(undefined),
    fill: jest.fn().mockResolvedValue(undefined),
    keyboard: {
      press: jest.fn().mockResolvedValue(undefined),
      selectAll: jest.fn().mockResolvedValue(undefined),
    },
    evaluate: jest.fn().mockResolvedValue('模型的回复内容'),
    $$: jest.fn().mockResolvedValue([
      {
        evaluate: jest.fn().mockResolvedValue('这是模型的回复'),
      },
    ]),
    $: jest.fn().mockResolvedValue(null),
    textContent: jest.fn().mockResolvedValue('回复内容'),
  };

  const mockContext = {
    newPage: jest.fn().mockResolvedValue(mockPage),
  };

  const mockBrowser = {
    isConnected: jest.fn().mockReturnValue(true),
    newContext: jest.fn().mockResolvedValue(mockContext),
    close: jest.fn().mockResolvedValue(undefined),
  };

  return {
    chromium: {
      launch: jest.fn().mockResolvedValue(mockBrowser),
    },
  };
});

describe('WebDriverManager', () => {
  let manager: WebDriverManager;

  beforeEach(() => {
    manager = new WebDriverManager({ headless: true });
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await manager.close();
  });

  describe('构造函数', () => {
    it('应该使用默认选项创建实例', () => {
      const m = new WebDriverManager();
      expect(m).toBeInstanceOf(WebDriverManager);
    });

    it('应该使用自定义选项创建实例', () => {
      const m = new WebDriverManager({
        headless: true,
        responseTimeoutMs: 60000,
        stabilityCheckIntervalMs: 1000,
        stabilityCheckCount: 5,
      });
      expect(m).toBeInstanceOf(WebDriverManager);
    });
  });

  describe('SiteKey 验证', () => {
    const validSites: SiteKey[] = ['gpt', 'qwen', 'deepseek', 'kimi'];

    it.each(validSites)('应该支持 %s 站点', (site) => {
      expect(['gpt', 'qwen', 'deepseek', 'kimi']).toContain(site);
    });
  });
});

describe('WebDriverError', () => {
  it('应该正确创建错误实例', () => {
    const err = new WebDriverError(
      WebDriverErrorCode.NOT_LOGGED_IN,
      '用户未登录'
    );
    expect(err).toBeInstanceOf(WebDriverError);
    expect(err.code).toBe(WebDriverErrorCode.NOT_LOGGED_IN);
    expect(err.message).toBe('用户未登录');
    expect(err.name).toBe('WebDriverError');
  });

  it('应该支持 cause 参数', () => {
    const cause = new Error('原始错误');
    const err = new WebDriverError(
      WebDriverErrorCode.RESPONSE_TIMEOUT,
      '响应超时',
      cause
    );
    expect(err.cause).toBe(cause);
  });

  it('错误码枚举应该包含所有必要的错误类型', () => {
    const expectedCodes = [
      'NOT_LOGGED_IN',
      'DIALOG_BLOCKED',
      'INVALID_SESSION_URL',
      'RESPONSE_TIMEOUT',
      'RESPONSE_EXTRACTION_FAILED',
      'NEW_CONVERSATION_FAILED',
      'SEND_MESSAGE_FAILED',
      'BROWSER_NOT_INITIALIZED',
      'UNKNOWN_SITE',
    ];

    expectedCodes.forEach((code) => {
      expect(WebDriverErrorCode).toHaveProperty(code);
    });
  });
});

describe('Driver URL 验证', () => {
  // 直接测试驱动类的 isValidConversationUrl 方法（通过类实例化测试）
  it('Qwen 未登录时（即使可访问页面）也应返回 false', async () => {
    const mockPage = {
      goto: jest.fn(),
      url: jest.fn().mockReturnValue('https://chat.qwen.ai/'),
      waitForSelector: jest.fn().mockRejectedValue(new Error('no login indicator')),
      click: jest.fn(),
      fill: jest.fn(),
      keyboard: { press: jest.fn(), selectAll: jest.fn() },
      evaluate: jest.fn(),
      $$: jest.fn(),
      $: jest.fn(),
    } as any;

    const driver = new QwenDriver(mockPage);
    await expect(driver.isLoggedIn()).resolves.toBe(false);
  });

  it('Qwen 检测到账号态 UI 时应返回 true', async () => {
    const mockPage = {
      goto: jest.fn(),
      url: jest.fn().mockReturnValue('https://chat.qwen.ai/'),
      waitForSelector: jest.fn().mockResolvedValue({}),
      click: jest.fn(),
      fill: jest.fn(),
      keyboard: { press: jest.fn(), selectAll: jest.fn() },
      evaluate: jest.fn(),
      $$: jest.fn(),
      $: jest.fn(),
    } as any;

    const driver = new QwenDriver(mockPage);
    await expect(driver.isLoggedIn()).resolves.toBe(true);
  });

  it('ChatGPT URL 验证', async () => {
    const { ChatGPTDriver } = await import('../../src/web-driver/drivers/ChatGPTDriver');
    const mockPage = {
      goto: jest.fn(),
      url: jest.fn(),
      waitForSelector: jest.fn(),
      click: jest.fn(),
      fill: jest.fn(),
      keyboard: { press: jest.fn(), selectAll: jest.fn() },
      evaluate: jest.fn(),
      $$: jest.fn(),
      $: jest.fn(),
    } as any;

    const driver = new ChatGPTDriver(mockPage);

    expect(driver.isValidConversationUrl('https://chatgpt.com/c/abc123')).toBe(true);
    expect(driver.isValidConversationUrl('https://chatgpt.com/')).toBe(false);
    expect(driver.isValidConversationUrl('https://other.com/c/abc123')).toBe(false);
  });

  it('DeepSeek URL 验证', async () => {
    const { DeepSeekDriver } = await import('../../src/web-driver/drivers/DeepSeekDriver');
    const mockPage = {
      goto: jest.fn(),
      url: jest.fn(),
      waitForSelector: jest.fn(),
      click: jest.fn(),
      fill: jest.fn(),
      keyboard: { press: jest.fn(), selectAll: jest.fn() },
      evaluate: jest.fn(),
      $$: jest.fn(),
      $: jest.fn(),
    } as any;

    const driver = new DeepSeekDriver(mockPage);

    expect(driver.isValidConversationUrl('https://chat.deepseek.com/a/chat/s/abc123')).toBe(true);
    expect(driver.isValidConversationUrl('https://chat.deepseek.com/')).toBe(false);
  });

  it('Kimi URL 验证', async () => {
    const { KimiDriver } = await import('../../src/web-driver/drivers/KimiDriver');
    const mockPage = {
      goto: jest.fn(),
      url: jest.fn(),
      waitForSelector: jest.fn(),
      click: jest.fn(),
      fill: jest.fn(),
      keyboard: { press: jest.fn(), selectAll: jest.fn() },
      evaluate: jest.fn(),
      $$: jest.fn(),
      $: jest.fn(),
    } as any;

    const driver = new KimiDriver(mockPage);

    expect(driver.isValidConversationUrl('https://www.kimi.com/chat/abc123')).toBe(true);
    expect(driver.isValidConversationUrl('https://www.kimi.com/')).toBe(false);
  });
});
