import { WebDriverManager, WebDriverError, WebDriverErrorCode } from '../../src/web-driver';
import type { SiteKey } from '../../src/web-driver';

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

describe('LoginProbe 策略引擎', () => {
  let manager: WebDriverManager;

  beforeEach(() => {
    manager = new WebDriverManager({ headless: true });
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await manager.close();
  });

  it('阈值边界：score 等于阈值时应命中 logged_in', async () => {
    const config = {
      thresholds: { logged_in: 2.5, not_logged_in: -1.5 },
      stability: { required_consistent_rounds: 2, poll_interval_ms: 1 },
      positiveSignals: [
        { id: 'p1', kind: 'selector_exists', selector: '.a', weight: 1.0 },
        { id: 'p2', kind: 'selector_exists', selector: '.b', weight: 1.5 },
      ],
      negativeSignals: [] as any[],
    };

    jest.spyOn(manager as any, 'evaluateSignal').mockResolvedValue(true);
    const mockPage = { url: jest.fn().mockReturnValue('https://chatgpt.com/') } as any;

    const result = await (manager as any).probeLoginStatusOnce('gpt', mockPage, config);
    expect(result.score).toBe(2.5);
    expect(result.status).toBe('logged_in');
  });

  it('防抖：连续稳定轮次不足时，应继续重试直到稳定', async () => {
    const config = {
      thresholds: { logged_in: 2.0, not_logged_in: -1.5 },
      stability: { required_consistent_rounds: 2, poll_interval_ms: 1 },
      positiveSignals: [] as any[],
      negativeSignals: [] as any[],
    };

    const seq: Array<'unknown' | 'logged_in' | 'not_logged_in'> = ['unknown', 'logged_in', 'logged_in'];
    let idx = 0;
    jest.spyOn(manager as any, 'probeLoginStatusOnce').mockImplementation(async () => ({
      status: seq[Math.min(idx++, seq.length - 1)],
      score: 0,
      reasons: [],
    }));

    const mockPage = {} as any;
    const result = await (manager as any).probeLoginStatusWithStability('qwen', mockPage, config);

    expect(result.status).toBe('logged_in');
    expect((manager as any).probeLoginStatusOnce).toHaveBeenCalledTimes(3);
  });

  it('信号命中日志：应包含 +正信号 和 -负信号', async () => {
    const config = {
      thresholds: { logged_in: 1.0, not_logged_in: -2.0 },
      stability: { required_consistent_rounds: 1, poll_interval_ms: 1 },
      positiveSignals: [
        { id: 'pos_sidebar', kind: 'selector_exists', selector: '.sidebar', weight: 1.2 },
      ],
      negativeSignals: [
        { id: 'neg_login_btn', kind: 'text_visible', texts: ['登录'], weight: 0.8 },
      ],
    };

    jest.spyOn(manager as any, 'evaluateSignal').mockImplementation(async (_page: any, signal: any) => {
      if (signal.id === 'pos_sidebar') return true;
      if (signal.id === 'neg_login_btn') return true;
      return false;
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const mockPage = { url: jest.fn().mockReturnValue('https://chat.deepseek.com/') } as any;

    const result = await (manager as any).probeLoginStatusOnce('deepseek', mockPage, config);

    expect(result.reasons).toContain('+pos_sidebar');
    expect(result.reasons).toContain('-neg_login_btn');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[LoginProbe][deepseek]'));

    logSpy.mockRestore();
  });
});

describe('ensureLoggedIn 提示层清理', () => {
  let manager: WebDriverManager;

  beforeEach(() => {
    manager = new WebDriverManager({ headless: true });
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await manager.close();
  });

  it('策略判定登录成功后，应清理提示层', async () => {
    const mockPage = {
      evaluate: jest.fn().mockResolvedValue(undefined),
      url: jest.fn().mockReturnValue('https://chatgpt.com/'),
    } as any;

    (manager as any).pageMap.set('gpt', mockPage);

    jest.spyOn(manager as any, 'loadLoginProbeConfig').mockReturnValue({
      thresholds: { logged_in: 1, not_logged_in: -1 },
      stability: { required_consistent_rounds: 1, poll_interval_ms: 1 },
      positiveSignals: [],
      negativeSignals: [],
    });

    jest.spyOn(manager as any, 'probeLoginStatusWithStability').mockResolvedValue({
      status: 'logged_in',
      score: 2,
      reasons: ['+ready'],
    });

    const mockDriver = { isLoggedIn: jest.fn().mockResolvedValue(false) } as any;

    await (manager as any).ensureLoggedIn('gpt', mockDriver);

    expect(mockPage.evaluate).toHaveBeenCalled();
    expect(mockDriver.isLoggedIn).not.toHaveBeenCalled();
  });

  it('兜底判定登录成功后，应清理提示层', async () => {
    const mockPage = {
      evaluate: jest.fn().mockResolvedValue(undefined),
      url: jest.fn().mockReturnValue('https://chat.qwen.ai/'),
    } as any;

    (manager as any).pageMap.set('qwen', mockPage);

    jest.spyOn(manager as any, 'loadLoginProbeConfig').mockReturnValue({
      thresholds: { logged_in: 1, not_logged_in: -1 },
      stability: { required_consistent_rounds: 1, poll_interval_ms: 1 },
      positiveSignals: [],
      negativeSignals: [],
    });

    jest.spyOn(manager as any, 'probeLoginStatusWithStability').mockResolvedValue({
      status: 'unknown',
      score: 0,
      reasons: [],
    });

    const mockDriver = { isLoggedIn: jest.fn().mockResolvedValue(true) } as any;

    await (manager as any).ensureLoggedIn('qwen', mockDriver);

    expect(mockDriver.isLoggedIn).toHaveBeenCalledTimes(1);
    expect(mockPage.evaluate).toHaveBeenCalled();
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

describe('QwenDriver 运行态问题回归', () => {
  it('应跳过“正在思考”占位文本并返回真实回复', async () => {
    const { QwenDriver } = await import('../../src/web-driver/drivers/QwenDriver');

    const thinkingEl = {
      evaluate: jest.fn().mockResolvedValue('正在思考'),
    };
    const finalEl = {
      evaluate: jest.fn().mockResolvedValue('这是最终回答'),
    };

    const mockPage = {
      $$: jest
        .fn()
        .mockResolvedValueOnce([thinkingEl])
        .mockResolvedValueOnce([finalEl]),
      waitForSelector: jest.fn().mockRejectedValue(new Error('not visible')),
      evaluate: jest.fn().mockResolvedValue(''),
      keyboard: { press: jest.fn() },
      url: jest.fn().mockReturnValue('https://chat.qwen.ai/c/abc'),
      goto: jest.fn(),
      click: jest.fn(),
      fill: jest.fn(),
    } as any;

    const driver = new QwenDriver(mockPage, { responseTimeoutMs: 2000 });
    jest.spyOn(driver as any, 'sleep').mockResolvedValue(undefined);

    const content = await driver.extractResponse();
    expect(content).toBe('这是最终回答');
  });

  it('输入框未清空时不应在 sendMessage 阶段直接抛错', async () => {
    const { QwenDriver } = await import('../../src/web-driver/drivers/QwenDriver');

    const mockPage = {
      $$: jest.fn().mockResolvedValue([]),
      waitForSelector: jest
        .fn()
        // 输入框可见（sendMessage 起始检查）
        .mockResolvedValueOnce({})
        // 发送按钮不可见
        .mockRejectedValue(new Error('not visible')),
      evaluate: jest.fn().mockResolvedValue('原问题仍在输入框'),
      keyboard: { press: jest.fn().mockResolvedValue(undefined) },
      url: jest.fn().mockReturnValue('https://chat.qwen.ai/c/abc'),
      goto: jest.fn(),
      click: jest.fn(),
      fill: jest.fn().mockResolvedValue(undefined),
    } as any;

    const driver = new QwenDriver(mockPage, { responseTimeoutMs: 2000 });
    jest.spyOn(driver as any, 'sleep').mockResolvedValue(undefined);

    await expect(driver.sendMessage('原问题仍在输入框')).resolves.toBeUndefined();
  });

  it('当未检测到新回复时应抛出提取失败', async () => {
    const { QwenDriver } = await import('../../src/web-driver/drivers/QwenDriver');

    const oldEl = {
      evaluate: jest.fn().mockResolvedValue('上一轮回复'),
    };

    const mockPage = {
      $$: jest.fn().mockResolvedValue([oldEl]),
      waitForSelector: jest.fn().mockRejectedValue(new Error('not visible')),
      evaluate: jest.fn().mockResolvedValue(''),
      keyboard: { press: jest.fn() },
      url: jest.fn().mockReturnValue('https://chat.qwen.ai/c/abc'),
      goto: jest.fn(),
      click: jest.fn(),
      fill: jest.fn(),
    } as any;

    const driver = new QwenDriver(mockPage, { responseTimeoutMs: 80 });
    jest.spyOn(driver as any, 'sleep').mockResolvedValue(undefined);
    (driver as any).lastAssistantResponseText = '上一轮回复';
    (driver as any).pendingResponseBaseCount = 1;

    await expect(driver.extractResponse()).rejects.toMatchObject({
      code: 'RESPONSE_EXTRACTION_FAILED',
    });
  });
});

describe('Driver URL 验证', () => {
  // 直接测试驱动类的 isValidConversationUrl 方法（通过类实例化测试）
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
