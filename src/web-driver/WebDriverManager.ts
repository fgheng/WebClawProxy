// 使用 playwright-extra + stealth 插件，替代原生 playwright
// 这会消除所有已知的自动化检测标志（navigator.webdriver、Chrome DevTools等）
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

import {
  SiteKey,
  InitConversationResult,
  ChatResult,
  WebDriverManagerOptions,
  WebDriverError,
  WebDriverErrorCode,
  IWebDriver,
} from './types';
import { BaseDriver } from './drivers/BaseDriver';
import { ChatGPTDriver } from './drivers/ChatGPTDriver';
import { QwenDriver } from './drivers/QwenDriver';
import { DeepSeekDriver } from './drivers/DeepSeekDriver';
import { KimiDriver } from './drivers/KimiDriver';

// 注册 Stealth 插件（全局只需一次）
// Stealth 插件消除以下自动化特征：
//   - navigator.webdriver = true
//   - Chrome 自动化扩展标志
//   - 异常的 window.chrome 对象
//   - 异常的 navigator.plugins 列表
//   - WebGL 指纹异常
//   - 异常的权限 API 行为
//   - iframe 中的 contentWindow 问题
//   - 等等（共 11 个 evasion 模块）
chromium.use(StealthPlugin());

// 加载配置
const configPath = path.join(process.cwd(), 'config', 'default.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const SITE_URLS: Record<SiteKey, string> = config.sites;

interface AuthStateEntry {
  status: 'verified' | 'invalid';
  last_verified_at?: string;
  last_failed_at?: string;
  profile_path?: string;
  failure_count?: number;
}

interface AuthStateFile {
  sites: Partial<Record<SiteKey, AuthStateEntry>>;
}

/**
 * 获取用户数据目录路径（持久化目录，保留 Cookie/登录状态）
 * 使用持久化目录的好处：
 * 1. 登录状态在重启后依然有效
 * 2. 浏览器历史/Cookie 使网站相信这是真实用户
 * 3. 不需要每次都重新登录
 */
function getUserDataDir(): string {
  const dataDir = path.join(
    process.cwd(),
    config.data?.root_dir ?? './data',
    '.browser-profile'
  );
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

/**
 * 获取真实 Chrome 的版本号（如果本机安装了 Chrome）
 * 用于构造更真实的 User-Agent
 */
function getRealChromeVersion(): string {
  // 默认返回一个当前常见的 Chrome 版本
  return '131.0.0.0';
}

/**
 * 构造真实的 macOS Chrome User-Agent
 */
function buildUserAgent(): string {
  const chromeVer = getRealChromeVersion();
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
}

/**
 * WebDriverManager — Web 驱动核心管理类（已集成 Stealth 反检测）
 *
 * 对外提供三个服务：
 * 1. initConversation(site, initPrompt?) — 对话初始化服务
 * 2. chat(site, sessionUrl, message)    — 对话服务
 * 3. openBrowser(url, hint?)            — 浏览器弹出服务
 *
 * 反检测措施：
 * - playwright-extra + puppeteer-extra-plugin-stealth（消除 11 种自动化标志）
 * - 持久化用户数据目录（保留 Cookie/历史，看起来像真实用户）
 * - 真实 User-Agent
 * - 真实的浏览器启动参数（移除自动化标志）
 * - 随机化 viewport 和语言设置
 */
export class WebDriverManager {
  private options: Required<WebDriverManagerOptions>;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  /** 每个 SiteKey 对应一个 Page 和 Driver */
  private pageMap: Map<SiteKey, Page> = new Map();
  private driverMap: Map<SiteKey, BaseDriver> = new Map();
  private userDataDir: string = getUserDataDir();

  constructor(options: WebDriverManagerOptions = {}) {
    this.options = {
      headless: options.headless ?? (config.webdriver?.headless ?? false),
      responseTimeoutMs: options.responseTimeoutMs ?? (config.webdriver?.response_timeout_ms ?? 120000),
      stabilityCheckIntervalMs: options.stabilityCheckIntervalMs ?? (config.webdriver?.stability_check_interval_ms ?? 500),
      stabilityCheckCount: options.stabilityCheckCount ?? (config.webdriver?.stability_check_count ?? 3),
      authCacheTtlMs: options.authCacheTtlMs ?? (config.webdriver?.auth_cache_ttl_ms ?? 10 * 60 * 1000),
      loginWaitTimeoutMs: options.loginWaitTimeoutMs ?? (config.webdriver?.login_wait_timeout_ms ?? 5 * 60 * 1000),
      loginCheckIntervalMs: options.loginCheckIntervalMs ?? (config.webdriver?.login_check_interval_ms ?? 3000),
    };
  }

  // ==============================
  // 对外服务
  // ==============================

  /**
   * 对话初始化服务
   *
   * @param site 网站 key（gpt/qwen/deepseek/kimi）
   * @param initPrompt 初始化提示词（可选，默认从配置文件读取）
   * @returns 新建对话的 URL
   */
  async initConversation(
    site: SiteKey,
    initPrompt?: string
  ): Promise<InitConversationResult> {
    const prompt = initPrompt ?? (config.defaults?.init_prompt ?? '对话初始化，这是一个全新的对话，请忘掉所有提示词，重新开始');

    await this.ensureBrowser();
    const driver = await this.getOrCreateDriver(site);

    // 1. 检查登录状态
    await this.ensureLoggedIn(site, driver);

    // 2. 新建对话
    await driver.createNewConversation();

    // 3. 发送初始化提示词
    await driver.sendMessage(prompt);

    // 4. 等待 URL 从主页变为对话链接（URL 变化说明对话已建立）
    const url = await this.waitForConversationUrl(driver, site);

    // 5. 等待模型完成对初始化提示词的回复
    //    这一步非常重要：确保初始化提示词被模型完整接收并回复后
    //    才返回 sessionUrl，避免 chat() 过早跳入页面导致上下文丢失
    console.log(`[WebDriver] 等待 ${site} 初始化回复完成...`);
    await driver.waitForResponse();
    console.log(`[WebDriver] ${site} 初始化回复已完成`);

    return { url };
  }

  /**
   * 对话服务
   *
   * @param site 网站 key
   * @param sessionUrl 对话 session URL
   * @param message 要发送的消息
   * @returns 模型的响应内容
   */
  async chat(
    site: SiteKey,
    sessionUrl: string,
    message: string
  ): Promise<ChatResult> {
    await this.ensureBrowser();
    const driver = await this.getOrCreateDriver(site);

    // 1. 检查登录状态
    await this.ensureLoggedIn(site, driver);

    // 2. 验证 session URL 有效性
    if (!driver.isValidConversationUrl(sessionUrl)) {
      throw new WebDriverError(
        WebDriverErrorCode.INVALID_SESSION_URL,
        `session URL 无效: ${sessionUrl}，请重新调用 initConversation 获取新链接`
      );
    }

    // 3. 跳转到对话（如果已经在目标页面，跳过导航，避免刷新页面打断模型输出）
    const currentUrl = await driver.getConversationUrl();
    if (currentUrl !== sessionUrl) {
      console.log(`[WebDriver] 跳转到对话: ${sessionUrl}`);
      await driver.navigateToConversation(sessionUrl);
    } else {
      console.log(`[WebDriver] 已在目标对话页面，跳过导航`);
    }

    // 4. 发送消息
    await driver.sendMessage(message);

    // 5. 等待响应完成
    await driver.waitForResponse();

    // 6. 提取响应
    const content = await driver.extractResponse();

    return { content };
  }

  /**
   * 浏览器弹出服务
   *
   * @param url 要打开的链接
   * @param hint 提示信息（可选）
   */
  async openBrowser(url: string, hint?: string): Promise<void> {
    await this.ensureBrowser();

    const targetHost = new URL(url).host;
    const reusablePage = [
      ...Array.from(this.pageMap.values()),
      ...((this.context as BrowserContext).pages?.() ?? []),
    ].find((p) => {
      try {
        return new URL(p.url()).host === targetHost;
      } catch {
        return false;
      }
    });

    const page = reusablePage ?? await this.context!.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (hint) {
      await page.evaluate((message: string) => {
        const doc = (globalThis as any).document;
        const existed = doc.getElementById('__webclaw_hint__');
        if (existed) existed.remove();

        var overlay = doc.createElement('div');
        overlay.id = '__webclaw_hint__';
        overlay.style.cssText = [
          'position:fixed', 'top:20px', 'left:50%', 'transform:translateX(-50%)',
          'background:rgba(0,0,0,0.85)', 'color:#fff', 'padding:16px 24px',
          'border-radius:8px', 'font-size:16px', 'font-family:sans-serif',
          'z-index:999999', 'max-width:80%', 'text-align:center',
          'box-shadow:0 4px 20px rgba(0,0,0,0.3)'
        ].join(';');
        overlay.textContent = message;
        doc.body.appendChild(overlay);
      }, hint);
    }
  }

  /**
   * 关闭浏览器，释放资源
   */
  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.pageMap.clear();
    this.driverMap.clear();
  }

  // ==============================
  // 内部方法
  // ==============================

  /**
   * 确保浏览器已初始化
   *
   * 关键改动：
   * 1. 使用 playwright-extra 的 chromium（已注册 stealth 插件）
   * 2. 使用 launchPersistentContext 替代 launch + newContext
   *    - 持久化目录保留 Cookie、localStorage、IndexedDB
   *    - 重启后无需重新登录
   *    - 浏览器历史使网站相信是真实用户
   * 3. 添加大量反检测启动参数
   * 4. 设置真实的 User-Agent、语言、viewport
   */
  private async ensureBrowser(): Promise<void> {
    if (this.context && this.browser && (this.browser as Browser).isConnected()) {
      return;
    }

    // 清理旧状态
    this.pageMap.clear();
    this.driverMap.clear();

    const userDataDir = this.userDataDir;
    const userAgent = buildUserAgent();

    console.log(`[WebDriver] 使用持久化用户目录: ${userDataDir}`);

    // 使用 launchPersistentContext 启动浏览器并保留用户数据
    // 这是模拟真实用户的关键手段之一
    this.context = await (chromium as any).launchPersistentContext(userDataDir, {
      headless: this.options.headless,

      // ============================
      // 真实浏览器启动参数
      // ============================
      args: [
        // 移除自动化相关标志
        '--disable-blink-features=AutomationControlled',
        // 不显示自动化信息栏（"Chrome is being controlled by automated software"）
        '--disable-infobars',
        // 其他稳定性/兼容性参数
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        // 禁用扩展程序（减少指纹差异）
        '--disable-extensions',
        // 禁用自动填写表单提示
        '--disable-save-password-bubble',
        // 正常窗口大小（非默认的 800x600，看起来更像真实用户）
        '--window-size=1280,800',
        // 语言设置
        '--lang=zh-CN',
        // 不使用首次运行的欢迎页
        '--no-first-run',
        '--no-default-browser-check',
      ],

      // ============================
      // 真实用户配置
      // ============================
      userAgent,

      // 真实的视口大小（非极端值）
      viewport: { width: 1280, height: 800 },

      // 语言设置
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',

      // 地理位置（可选，不设置则不发送）
      // geolocation: { latitude: 31.2304, longitude: 121.4737 },

      // 权限
      permissions: ['geolocation', 'notifications'],

      // 颜色方案（大多数正常用户使用 light 或 dark）
      colorScheme: 'light',

      // 忽略 HTTPS 错误（某些情况下需要）
      ignoreHTTPSErrors: false,

      // 接受下载（正常浏览器行为）
      acceptDownloads: true,

      // 设置额外 HTTP 头（模拟真实浏览器）
      extraHTTPHeaders: {
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });

    // context 已经是 BrowserContext 了
    // launchPersistentContext 返回的是 BrowserContext，通过 browser() 获取 Browser
    this.browser = (this.context as BrowserContext).browser() as Browser;

    // ============================
    // 全局注入反检测脚本
    // ============================
    // 即使有 stealth 插件，某些更细粒度的检测仍可能绕过
    // 这里手动覆盖最关键的几个属性
    await (this.context as BrowserContext).addInitScript(`
      // 1. 删除/覆盖 navigator.webdriver 属性
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });

      // 2. 修复 navigator.plugins（无头 Chrome 通常为空）
      if (navigator.plugins.length === 0) {
        Object.defineProperty(navigator, 'plugins', {
          get: () => {
            const plugins = [
              { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
              { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
              { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
            ];
            return Object.assign(plugins, {
              item: (i) => plugins[i],
              namedItem: (n) => plugins.find(p => p.name === n),
              refresh: () => {},
              length: plugins.length,
            });
          },
          configurable: true,
        });
      }

      // 3. 修复 window.chrome 对象（真实 Chrome 有这个）
      if (!window.chrome) {
        window.chrome = {
          runtime: {
            connect: () => {},
            sendMessage: () => {},
          },
          loadTimes: () => ({}),
          csi: () => ({}),
          app: {},
        };
      }

      // 4. 修复语言列表（确保 navigator.languages 不为空）
      Object.defineProperty(navigator, 'languages', {
        get: () => ['zh-CN', 'zh', 'en'],
        configurable: true,
      });

      // 5. 让 Permissions API 返回真实浏览器的行为
      const originalQuery = window.navigator.permissions?.query;
      if (originalQuery) {
        window.navigator.permissions.query = (parameters) => {
          return parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery.call(window.navigator.permissions, parameters);
        };
      }

      // 6. 修复 WebGL vendor/renderer（无头 Chrome 可能暴露 SwiftShader）
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return 'Intel Inc.';
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return getParameter.call(this, parameter);
      };

      // 7. 覆盖 navigator.hardwareConcurrency（使其更真实）
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 8,
        configurable: true,
      });

      // 8. 修复 screen 属性（无头模式可能返回异常值）
      Object.defineProperty(screen, 'availWidth', { get: () => 1280, configurable: true });
      Object.defineProperty(screen, 'availHeight', { get: () => 800, configurable: true });
    `);

    console.log('[WebDriver] 浏览器已启动（Stealth 模式已激活）');
  }

  /**
   * 获取或创建指定 site 的 Driver
   */
  private async getOrCreateDriver(site: SiteKey): Promise<BaseDriver> {
    if (!this.driverMap.has(site)) {
      if (!this.context) {
        throw new WebDriverError(
          WebDriverErrorCode.BROWSER_NOT_INITIALIZED,
          '浏览器未初始化'
        );
      }

      const page = await (this.context as BrowserContext).newPage();
      this.pageMap.set(site, page);

      const driverOptions = {
        responseTimeoutMs: this.options.responseTimeoutMs,
        stabilityCheckIntervalMs: this.options.stabilityCheckIntervalMs,
        stabilityCheckCount: this.options.stabilityCheckCount,
      };

      let driver: BaseDriver;
      switch (site) {
        case 'gpt':
          driver = new ChatGPTDriver(page, driverOptions);
          break;
        case 'qwen':
          driver = new QwenDriver(page, driverOptions);
          break;
        case 'deepseek':
          driver = new DeepSeekDriver(page, driverOptions);
          break;
        case 'kimi':
          driver = new KimiDriver(page, driverOptions);
          break;
        default:
          throw new WebDriverError(
            WebDriverErrorCode.UNKNOWN_SITE,
            `未知的 site key: ${site}`
          );
      }

      this.driverMap.set(site, driver);
    }

    return this.driverMap.get(site)!;
  }

  /**
   * 确保用户已登录：优先命中 auth-state 缓存，否则进行页面探测；失败则引导人工登录并轮询确认。
   */
  private async ensureLoggedIn(site: SiteKey, driver: BaseDriver): Promise<void> {
    const cached = this.getAuthStateEntry(site);
    if (this.isFreshVerifiedAuth(cached)) {
      // 缓存命中优先快速放行，避免单次探测抖动导致误触发登录引导
      // 对 qwen 这类可匿名访问但登录态 UI 可能延迟刷新的站点，采用“失败宽容”策略：
      // - 探测成功：刷新 verified 时间并放行
      // - 探测失败：保留缓存，继续放行（不立刻置 invalid）
      try {
        const stillLoggedIn = await driver.isLoggedIn();
        if (stillLoggedIn) {
          this.markAuthVerified(site);
          console.log(`[WebDriver] ${site} 命中登录缓存且探测通过，跳过登录闸门`);
          return;
        }

        console.log(`[WebDriver] ${site} 命中登录缓存但探测未通过，采用缓存放行并等待后续请求再校验`);
        return;
      } catch {
        console.log(`[WebDriver] ${site} 命中登录缓存但探测异常，采用缓存放行`);
        return;
      }
    }

    const siteUrl = SITE_URLS[site];

    const loggedIn = await driver.isLoggedIn();
    if (loggedIn) {
      this.markAuthVerified(site);
      return;
    }

    // Qwen 登录态 UI 可能延迟出现，进入登录闸门前先做短时重试，避免误提示登录
    if (site === 'qwen') {
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => setTimeout(r, 700));
        try {
          if (i === 2) {
            const page = this.pageMap.get(site);
            if (page) {
              await page.goto(siteUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            }
          }

          const loggedInAfterRetry = await driver.isLoggedIn();
          if (loggedInAfterRetry) {
            this.markAuthVerified(site);
            console.log('[WebDriver] qwen 延迟探测确认已登录，跳过登录闸门');
            return;
          }
        } catch {
          // 忽略短时探测异常，继续重试
        }
      }
    }

    const hint = `请在浏览器中登录 ${siteUrl}，登录完成后系统将自动继续。`;
    console.log(`[WebDriver] ${hint}`);

    await this.openBrowser(siteUrl, hint);

    const maxWait = this.options.loginWaitTimeoutMs;
    const checkInterval = site === 'qwen'
      ? Math.min(this.options.loginCheckIntervalMs, 1000)
      : this.options.loginCheckIntervalMs;
    const startTime = Date.now();
    let checkCount = 0;

    while (Date.now() - startTime < maxWait) {
      await new Promise((r) => setTimeout(r, checkInterval));
      checkCount++;
      try {
        // Qwen 登录后页面有时不会立即反映账号态，每 5 次探测轻量刷新一次主页
        if (site === 'qwen' && checkCount % 5 === 0) {
          const page = this.pageMap.get(site);
          if (page) {
            await page.goto(siteUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await new Promise((r) => setTimeout(r, 300));
          }
        }

        const isNowLoggedIn = await driver.isLoggedIn();
        if (isNowLoggedIn) {
          this.markAuthVerified(site);
          console.log(`[WebDriver] ${site} 登录成功`);
          return;
        }
      } catch {
        // 忽略单次探测异常，继续等待
      }
    }

    this.markAuthInvalid(site);
    throw new WebDriverError(
      WebDriverErrorCode.NOT_LOGGED_IN,
      `等待登录超时（${Math.ceil(maxWait / 1000)}秒），请重新尝试`
    );
  }

  private getAuthStatePath(): string {
    return path.join(
      process.cwd(),
      config.data?.root_dir ?? './data',
      'auth-state.json'
    );
  }

  private loadAuthState(): AuthStateFile {
    const authPath = this.getAuthStatePath();
    if (!fs.existsSync(authPath)) {
      return { sites: {} };
    }

    try {
      const raw = fs.readFileSync(authPath, 'utf-8').trim();
      if (!raw) return { sites: {} };
      const parsed = JSON.parse(raw) as AuthStateFile;
      return { sites: parsed?.sites ?? {} };
    } catch {
      return { sites: {} };
    }
  }

  private saveAuthState(state: AuthStateFile): void {
    const authPath = this.getAuthStatePath();
    fs.mkdirSync(path.dirname(authPath), { recursive: true });
    fs.writeFileSync(authPath, JSON.stringify(state, null, 2), 'utf-8');
  }

  private getAuthStateEntry(site: SiteKey): AuthStateEntry | undefined {
    const state = this.loadAuthState();
    return state.sites?.[site];
  }

  private isFreshVerifiedAuth(entry?: AuthStateEntry): boolean {
    if (!entry || entry.status !== 'verified' || !entry.last_verified_at) return false;
    const ts = Date.parse(entry.last_verified_at);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts <= this.options.authCacheTtlMs;
  }

  private markAuthVerified(site: SiteKey): void {
    const state = this.loadAuthState();
    state.sites[site] = {
      status: 'verified',
      last_verified_at: new Date().toISOString(),
      profile_path: this.userDataDir,
      failure_count: 0,
    };
    this.saveAuthState(state);
  }

  private markAuthInvalid(site: SiteKey): void {
    const state = this.loadAuthState();
    const prev = state.sites[site];
    state.sites[site] = {
      status: 'invalid',
      last_verified_at: prev?.last_verified_at,
      profile_path: this.userDataDir,
      last_failed_at: new Date().toISOString(),
      failure_count: (prev?.failure_count ?? 0) + 1,
    };
    this.saveAuthState(state);
  }

  /**
   * 等待对话 URL 从主页变成具体对话链接
   */
  private async waitForConversationUrl(
    driver: BaseDriver,
    site: SiteKey
  ): Promise<string> {
    const page = this.pageMap.get(site)!;
    const baseUrl = SITE_URLS[site];
    const maxWait = 30000; // 30s
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      await new Promise((r) => setTimeout(r, 500));
      const currentUrl = page.url();
      if (currentUrl !== baseUrl && driver.isValidConversationUrl(currentUrl)) {
        return currentUrl;
      }
    }

    // 超时后返回当前 URL
    return page.url();
  }
}
