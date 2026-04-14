// 使用 playwright-extra + stealth 插件，替代原生 playwright
// 这会消除所有已知的自动化检测标志（navigator.webdriver、Chrome DevTools等）
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

import {
  SiteKey,
  InitConversationResult,
  ChatResult,
  PromptDispatchMode,
  PromptDispatchOptions,
  WebDriverManagerOptions,
  WebDriverError,
  WebDriverErrorCode,
} from './types';
import { BaseDriver } from './drivers/BaseDriver';
import { ChatGPTDriver } from './drivers/ChatGPTDriver';
import { QwenDriver } from './drivers/QwenDriver';
import { DeepSeekDriver } from './drivers/DeepSeekDriver';
import { KimiDriver } from './drivers/KimiDriver';
import { GLMDriver } from './drivers/GLMDriver';
import { getNormalizedProviderConfigMap, isSiteKey } from '../config/provider-config';
import { BrowserBackend, BrowserBackendName } from './backends/types';
import { PlaywrightLaunchBackend } from './backends/PlaywrightLaunchBackend';
import { ElectronCdpBackend } from './backends/ElectronCdpBackend';
import { loadAppConfig } from '../config/app-config';

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
const config = loadAppConfig();

function getSiteUrlsFromConfig(): Record<SiteKey, string> {
  const providers = getNormalizedProviderConfigMap();
  const fromProviders: Partial<Record<SiteKey, string>> = {};
  for (const [key, provider] of Object.entries(providers)) {
    if (isSiteKey(key)) {
      const site = (provider.web.site ?? '').trim();
      if (site) {
        fromProviders[key] = site;
      }
    }
  }
  return fromProviders as Record<SiteKey, string>;
}

const SITE_URLS: Record<SiteKey, string> = getSiteUrlsFromConfig();

type ProbeStatus = 'logged_in' | 'not_logged_in' | 'unknown';

type ProbeSignalKind = 'selector_exists' | 'selector_visible' | 'text_visible' | 'url_regex';

interface LoginProbeSignal {
  id: string;
  kind: ProbeSignalKind;
  selector?: string;
  texts?: string[];
  pattern?: string;
  weight: number;
}

interface LoginProbeConfig {
  thresholds: {
    logged_in: number;
    not_logged_in: number;
  };
  stability: {
    required_consistent_rounds: number;
    poll_interval_ms: number;
  };
  positiveSignals: LoginProbeSignal[];
  negativeSignals: LoginProbeSignal[];
}

interface LoginProbeConfigPatch {
  thresholds?: Partial<LoginProbeConfig['thresholds']>;
  stability?: Partial<LoginProbeConfig['stability']>;
  positiveSignals?: LoginProbeSignal[];
  negativeSignals?: LoginProbeSignal[];
}

interface LoginProbeResult {
  status: ProbeStatus;
  score: number;
  reasons: string[];
}

interface InternalPromptDispatchOptions {
  prompt: string;
  mode: PromptDispatchMode;
  responseSchemaTemplate?: string;
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
  private backend: BrowserBackend | null = null;
  /** 每个 SiteKey 对应一个 Page 和 Driver */
  private pageMap: Map<SiteKey, Page> = new Map();
  private driverMap: Map<SiteKey, BaseDriver> = new Map();
  /** 每个 provider 一条串行链，避免同一站点并发抢占同一个 page/driver */
  private siteTaskTails: Map<SiteKey, Promise<void>> = new Map();

  constructor(options: WebDriverManagerOptions = {}) {
    this.options = {
      headless: options.headless ?? (config.webdriver?.headless ?? false),
      browserBackend: options.browserBackend ?? (process.env.WEBCLAW_BROWSER_BACKEND as BrowserBackendName) ?? 'playwright-launch',
      responseTimeoutMs: options.responseTimeoutMs ?? (config.webdriver?.response_timeout_ms ?? 120000),
      stabilityCheckIntervalMs: options.stabilityCheckIntervalMs ?? (config.webdriver?.stability_check_interval_ms ?? 500),
      stabilityCheckCount: options.stabilityCheckCount ?? (config.webdriver?.stability_check_count ?? 3),
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
    return this.runWithSiteLock(site, async () => {
      const prompt = initPrompt ?? this.resolveDefaultInitPrompt();

      await this.ensureBrowser();
      const driver = await this.getOrCreateDriver(site);

      // 登录态检查已由服务启动预检承担；初始化流程不再重复判断

      // 2. 新建对话
      await driver.createNewConversation();

      // 发送初始化提示词前，等待页面稳定，避免刚新建对话时输入被吞
      await this.waitForPageReadyBeforeSend(site);

      // 3. 发送初始化提示词（含超长分段保护）
      await this.dispatchPrompt(site, driver, {
        prompt,
        mode: 'init',
      });

      // 4. 等待 URL 从主页变为对话链接（URL 变化说明对话已建立）
      const url = await this.waitForConversationUrl(driver, site);

      // 5. 等待模型完成对初始化提示词的回复
      //    这一步非常重要：确保初始化提示词被模型完整接收并回复后
      //    才返回 sessionUrl，避免 chat() 过早跳入页面导致上下文丢失
      console.log(`[WebDriver] 等待 ${site} 初始化回复完成...`);
      try {
        await driver.waitForResponse();
        console.log(`[WebDriver] ${site} 初始化回复已完成`);
      } catch {
        // 即使等待超时也继续（已获取 URL 就足够了）
        console.warn(`[WebDriver] ${site} 初始化回复等待超时，继续执行`);
      }

      return { url };
    });
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
    message: string,
    options: PromptDispatchOptions = {}
  ): Promise<ChatResult> {
    return this.runWithSiteLock(site, async () => {
      const driver = await this.executeSendFlow(site, sessionUrl, message, options);

      // 6. 提取响应
      const content = await driver.extractResponse();

      return { content };
    });
  }

  /**
   * 仅发送并等待完成，不提取回复内容。
   * 用于长文本分段发送时的前置分段。
   */
  async sendOnly(
    site: SiteKey,
    sessionUrl: string,
    message: string,
    options: PromptDispatchOptions = {}
  ): Promise<void> {
    await this.runWithSiteLock(site, async () => {
      await this.executeSendFlow(site, sessionUrl, message, options);
    });
  }

  /**
   * 浏览器弹出服务
   *
   * @param url 要打开的链接
   * @param hint 提示信息（可选）
   */
  async openBrowser(url: string, hint?: string): Promise<void> {
    await this.ensureBrowser();

    const backend = this.getBackend();
    const page = await backend.getOrCreatePageForUrl(url);
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

  async preflightConfiguredSites(sites?: SiteKey[]): Promise<void> {
    await this.ensureBrowser();
    const targetSites = sites ?? (Object.keys(SITE_URLS) as SiteKey[]);

    for (const site of targetSites) {
      const driver = await this.getOrCreateDriver(site);
      console.log(`[WebDriver] 启动预检：${site}`);
      await this.ensureLoggedIn(site, driver);
      console.log(`[WebDriver] 启动预检通过：${site}`);
    }
  }

  async openConfiguredSites(sites?: SiteKey[]): Promise<void> {
    await this.ensureBrowser();
    const targetSites = sites ?? (Object.keys(SITE_URLS) as SiteKey[]);

    for (const site of targetSites) {
      const siteUrl = SITE_URLS[site];
      if (!siteUrl) continue;
      console.log(`[WebDriver] 启动打开站点：${site} -> ${siteUrl}`);
      await this.openSitePage(site);
    }
  }

  private async executeSendFlow(
    site: SiteKey,
    sessionUrl: string,
    message: string,
    options: PromptDispatchOptions = {}
  ): Promise<BaseDriver> {
    await this.ensureBrowser();
    const driver = await this.getOrCreateDriver(site);

    // 登录态检查在服务启动预检阶段完成，chat 路径不再重复检查

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
      // 跳转后等待页面稳定，再发送消息
      await this.waitForPageReadyBeforeSend(site);
    } else {
      console.log(`[WebDriver] 已在目标对话页面，跳过导航`);
      // 即使未跳转，也做一次轻量稳定等待，避免页面刚切换完成时输入丢失
      await this.waitForPageReadyBeforeSend(site);
    }

    // 4. 发送消息（含超长分段保护）
    await this.dispatchPrompt(site, driver, {
      prompt: message,
      mode: options.mode ?? 'chat',
      responseSchemaTemplate: options.responseSchemaTemplate,
    });

    // 5. 等待响应完成
    await driver.waitForResponse();

    return driver;
  }

  private resolveDefaultInitPrompt(): string {
    const configured = config.defaults?.init_prompt;
    if (typeof configured === 'string' && configured.trim() !== '') {
      return this.renderInitPromptTemplate(configured);
    }
    return '对话初始化，这是一个全新的对话，请忘掉所有提示词，重新开始';
  }

  private renderInitPromptTemplate(template: string): string {
    const responseSchemaTemplate = config.defaults?.response_schema_template ?? '';
    return template.split('{{response_schema_template}}').join(responseSchemaTemplate);
  }

  private getInputMaxChars(site: SiteKey): number | undefined {
    const providers = getNormalizedProviderConfigMap();
    const limit = providers[site]?.web.input_max_chars;
    return typeof limit === 'number' && limit > 0 ? limit : undefined;
  }

  private splitPromptByLimit(prompt: string, maxChars?: number): string[] {
    if (!maxChars || maxChars <= 0 || prompt.length <= maxChars) {
      return [prompt];
    }

    const chunks: string[] = [];
    let cursor = 0;
    while (cursor < prompt.length) {
      const end = Math.min(cursor + maxChars, prompt.length);
      let cut = end;

      if (end < prompt.length) {
        const window = prompt.slice(cursor, end);
        const paragraphCut = window.lastIndexOf('\n\n');
        const lineCut = window.lastIndexOf('\n');
        const softCut = Math.max(paragraphCut, lineCut);
        if (softCut > Math.floor(maxChars * 0.4)) {
          cut = cursor + softCut;
        }
      }

      if (cut <= cursor) {
        cut = end;
      }

      chunks.push(prompt.slice(cursor, cut));
      cursor = cut;
    }

    return chunks.filter((chunk) => chunk.length > 0);
  }

  private buildChunkPrompt(options: {
    chunk: string;
    chunkIndex: number;
    chunkTotal: number;
    mode: PromptDispatchMode;
    responseSchemaTemplate?: string;
  }): string {
    const { chunk, chunkIndex, chunkTotal, mode, responseSchemaTemplate } = options;
    if (chunkTotal <= 1) return chunk;

    const seq = `${chunkIndex + 1}/${chunkTotal}`;
    const startMarker = `<|wc_chunk_start:${seq}|>`;
    const endMarker = `<|wc_chunk_end:${seq}|>`;
    const allEndMarker = '<|wc_all_chunks_end|>';
    const wrappedChunk = [startMarker, chunk, endMarker].join('\n');

    if (chunkIndex === 0) {
      return [
        `[Chunked input ${seq}] The remaining content is long and will be sent in chunks.`,
        `When you see ${startMarker} to ${endMarker}, that indicates one content chunk.`,
        `Before you see ${allEndMarker}, reply only with "Received" and do not provide the final answer.`,
        '---',
        wrappedChunk,
        'Reply only with: Received',
      ].join('\n');
    }

    if (chunkIndex < chunkTotal - 1) {
      return [
        `[Chunked input ${seq}] Middle chunk.`,
        wrappedChunk,
        'Reply only with: Received',
      ].join('\n');
    }

    if (mode === 'init') {
      return [
        `[Chunked input ${seq}] Final chunk.`,
        wrappedChunk,
        allEndMarker,
        'All initialization chunks have now been sent. Complete the initialization based on the full content and reply only with: Received',
      ].join('\n');
    }

    if (mode === 'retry') {
      return [
        `[Chunked input ${seq}] Final chunk.`,
        wrappedChunk,
        allEndMarker,
        'All chunks have now been sent. Please answer again based on the full chunked content.',
        'Strictly follow the earlier instructions and do not add extra explanation.',
      ].join('\n');
    }

    return [
      `[Chunked input ${seq}] Final chunk.`,
      wrappedChunk,
      allEndMarker,
      'All chunks have now been sent. Please provide the final answer based on the full chunked content.',
      'Output strictly in the following format, with no extra explanation.',
      responseSchemaTemplate ?? '',
    ].join('\n');
  }

  private async dispatchPrompt(
    site: SiteKey,
    driver: BaseDriver,
    options: InternalPromptDispatchOptions
  ): Promise<void> {
    const maxChars = this.getInputMaxChars(site);
    const chunks = this.splitPromptByLimit(options.prompt, maxChars);

    for (let i = 0; i < chunks.length; i++) {
      const prompt = this.buildChunkPrompt({
        chunk: chunks[i],
        chunkIndex: i,
        chunkTotal: chunks.length,
        mode: options.mode,
        responseSchemaTemplate: options.responseSchemaTemplate,
      });

      await driver.sendMessage(prompt);

      if (i < chunks.length - 1) {
        await driver.waitForResponse();
        await this.waitForPageReadyBeforeSend(site);
      }
    }
  }

  private async openSitePage(site: SiteKey): Promise<Page> {
    const siteUrl = SITE_URLS[site];
    if (!siteUrl) {
      throw new WebDriverError(WebDriverErrorCode.UNKNOWN_SITE, `未知的 site key: ${site}`);
    }

    const backend = this.getBackend();
    const page = await backend.getOrCreatePageForSite(site, siteUrl);
    await page.goto(siteUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    this.pageMap.set(site, page);

    // 页面绑定变化后，确保后续 driver 与 page 一致
    this.driverMap.delete(site);

    return page;
  }

  /**
   * 关闭浏览器，释放资源
   */
  async close(): Promise<void> {
    if (this.backend) {
      await this.backend.close();
      this.backend = null;
    }
    this.pageMap.clear();
    this.driverMap.clear();
    this.siteTaskTails.clear();
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
    if (this.backend?.isReady()) {
      return;
    }

    // 清理旧状态
    this.pageMap.clear();
    this.driverMap.clear();
    this.siteTaskTails.clear();

    this.backend = this.createBackend();
    await this.backend.ensureReady();
    console.log(`[WebDriver] 浏览器后端已就绪: ${this.options.browserBackend}`);
  }

  private createBackend(): BrowserBackend {
    if (this.options.browserBackend === 'electron-cdp') {
      const cdpUrl = process.env.WEBCLAW_CDP_URL ?? 'http://127.0.0.1:9222';
      return new ElectronCdpBackend({ cdpUrl });
    }

    const userDataDir = getUserDataDir();
    const userAgent = buildUserAgent();
    console.log(`[WebDriver] 使用持久化用户目录: ${userDataDir}`);
    return new PlaywrightLaunchBackend({
      headless: this.options.headless,
      userDataDir,
      userAgent,
    });
  }

  private getBackend(): BrowserBackend {
    if (!this.backend) {
      throw new WebDriverError(WebDriverErrorCode.BROWSER_NOT_INITIALIZED, '浏览器未初始化');
    }
    return this.backend;
  }

  private async runWithSiteLock<T>(site: SiteKey, task: () => Promise<T>): Promise<T> {
    const previous = this.siteTaskTails.get(site) ?? Promise.resolve();

    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.siteTaskTails.set(site, previous.catch(() => undefined).then(() => current));

    await previous.catch(() => undefined);

    try {
      return await task();
    } finally {
      release();
      if (this.siteTaskTails.get(site) === current) {
        this.siteTaskTails.delete(site);
      }
    }
  }

  /**
   * 获取或创建指定 site 的 Driver
   */
  private async waitForPageReadyBeforeSend(site: SiteKey): Promise<void> {
    const page = this.pageMap.get(site);
    if (!page) return;

    const inputSelectorBySite: Record<SiteKey, string> = {
      gpt: '#prompt-textarea',
      qwen: 'textarea:not([readonly]):not([aria-hidden="true"]), [contenteditable="true"]:not([aria-hidden="true"])',
      deepseek: 'textarea, [contenteditable="true"]',
      kimi: 'textarea, [contenteditable="true"][class*="input"]',
      glm: 'textarea:not([readonly]):not([aria-hidden="true"]), [contenteditable="true"]:not([aria-hidden="true"])',
    };

    const readinessProfileBySite: Record<
      SiteKey,
      {
        maxWaitMs: number;
        requiredStableRounds: number;
        intervalMs: number;
        finalBufferMs: number;
        requireUrlStability: boolean;
      }
    > = {
      gpt: {
        maxWaitMs: 5000,
        requiredStableRounds: 2,
        intervalMs: 250,
        finalBufferMs: 250,
        requireUrlStability: true,
      },
      qwen: {
        maxWaitMs: 5000,
        requiredStableRounds: 2,
        intervalMs: 250,
        finalBufferMs: 250,
        requireUrlStability: true,
      },
      deepseek: {
        maxWaitMs: 5000,
        requiredStableRounds: 2,
        intervalMs: 250,
        finalBufferMs: 250,
        requireUrlStability: true,
      },
      // Kimi 初始化输入框可交互后即可发送，避免 URL 稳定等待导致初始提示词写入慢
      kimi: {
        maxWaitMs: 1800,
        requiredStableRounds: 1,
        intervalMs: 120,
        finalBufferMs: 80,
        requireUrlStability: false,
      },
      glm: {
        maxWaitMs: 5000,
        requiredStableRounds: 2,
        intervalMs: 250,
        finalBufferMs: 250,
        requireUrlStability: true,
      },
    };

    const profile = readinessProfileBySite[site];

    // 1) 等待文档事件（若 API 可用）
    try {
      await (page as any).waitForLoadState?.('domcontentloaded', { timeout: 4000 });
    } catch {
      // 忽略，继续走稳定性判断
    }

    // 2) 页面可发送判定（URL 稳定 + 输入框可交互）
    let lastUrl = '';
    let stableRounds = 0;
    const start = Date.now();
    const inputSelector = inputSelectorBySite[site];

    while (Date.now() - start < profile.maxWaitMs && stableRounds < profile.requiredStableRounds) {
      const currentUrl = page.url?.() ?? '';
      const pageReady = await page
        .evaluate(([selector, siteKey]: [string, SiteKey]) => {
          const doc = (globalThis as any).document;
          const el = doc.querySelector(selector as string) as any;
          if (!el) return false;

          const getStyle = (globalThis as any).getComputedStyle;
          const isVisible = (node: any) => {
            if (!node) return false;
            const style = getStyle?.(node);
            const rect = node.getBoundingClientRect?.();
            return !style || (
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              (rect ? rect.width > 0 && rect.height > 0 : true)
            );
          };

          const inputVisible = isVisible(el);
          const inputEnabled = !el.disabled && el.getAttribute?.('aria-disabled') !== 'true';
          if (!inputVisible || !inputEnabled) return false;

          if (siteKey !== 'gpt') {
            return true;
          }

          const stopButton = doc.querySelector('[data-testid="stop-button"]') as any;
          const blockingOverlayVisible = Array.from(doc.querySelectorAll('[role="dialog"]')).some((node) => isVisible(node));

          // ChatGPT 的发送按钮可能要在输入文本后才激活/挂载。
          // 发送前稳定性判定只要求输入框本身可交互，且当前不在生成态、没有弹窗遮挡。
          return Boolean(!stopButton && !blockingOverlayVisible);
        }, [inputSelector, site] as [string, SiteKey])
        .catch(() => false);

      const ready = profile.requireUrlStability
        ? Boolean(currentUrl && currentUrl === lastUrl && pageReady)
        : Boolean(pageReady);

      if (ready) {
        stableRounds++;
      } else {
        stableRounds = 0;
        lastUrl = currentUrl;
      }

      await new Promise((r) => setTimeout(r, profile.intervalMs));
    }

    // 3) 最后缓冲，给前端框架渲染一个小窗口
    await new Promise((r) => setTimeout(r, profile.finalBufferMs));
  }

  private async getOrCreateDriver(site: SiteKey): Promise<BaseDriver> {
    if (!this.driverMap.has(site)) {
      if (!this.backend) {
        throw new WebDriverError(
          WebDriverErrorCode.BROWSER_NOT_INITIALIZED,
          '浏览器未初始化'
        );
      }

      let page = this.pageMap.get(site);
      if (!page) {
        const siteUrl = SITE_URLS[site];
        page = await this.backend.getOrCreatePageForSite(site, siteUrl);
        this.pageMap.set(site, page);
      }

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
        case 'glm':
          driver = new GLMDriver(page, driverOptions);
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

  private async ensureLoggedIn(site: SiteKey, driver: BaseDriver): Promise<void> {
    const page = this.pageMap.get(site);
    if (!page) {
      throw new WebDriverError(WebDriverErrorCode.BROWSER_NOT_INITIALIZED, `站点页面未初始化: ${site}`);
    }

    const probeConfig = this.loadLoginProbeConfig(site);
    const stableProbe = await this.probeLoginStatusWithStability(site, page, probeConfig);
    if (stableProbe.status === 'logged_in') {
      await this.clearLoginHintOverlay(page);
      return;
    }

    // 保留原站点驱动判定作为兜底（兼容配置尚未覆盖的站点细节）
    const fallbackLoggedIn = await driver.isLoggedIn();
    if (fallbackLoggedIn) {
      await this.clearLoginHintOverlay(page);
      return;
    }

    const siteUrl = SITE_URLS[site];
    const hint = `请在浏览器中登录 ${siteUrl}，登录完成后系统将自动继续。`;
    console.log(`[WebDriver] ${hint}`);

    await this.openBrowser(siteUrl, hint);

    const maxWait = 5 * 60 * 1000;
    const checkInterval = Math.max(500, probeConfig.stability.poll_interval_ms);
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      await new Promise((r) => setTimeout(r, checkInterval));

      const latestPage = this.pageMap.get(site) ?? page;
      const roundProbe = await this.probeLoginStatusWithStability(site, latestPage, probeConfig);
      if (roundProbe.status === 'logged_in') {
        console.log(`[WebDriver] ${site} 登录成功（策略判定）`);
        await this.clearLoginHintOverlay(latestPage);
        return;
      }

      try {
        const fallback = await driver.isLoggedIn();
        if (fallback) {
          console.log(`[WebDriver] ${site} 登录成功（驱动兜底判定）`);
          await this.clearLoginHintOverlay(latestPage);
          return;
        }
      } catch {
        // 忽略单次兜底异常，继续轮询
      }
    }

    throw new WebDriverError(
      WebDriverErrorCode.NOT_LOGGED_IN,
      `等待登录超时（5分钟），请重新尝试`
    );
  }

  private async clearLoginHintOverlay(page: Page): Promise<void> {
    try {
      await page.evaluate(() => {
        const doc = (globalThis as any).document;
        const existed = doc?.getElementById?.('__webclaw_hint__');
        if (existed) existed.remove();
      });
    } catch {
      // 清理提示层失败不影响主流程
    }
  }

  private loadLoginProbeConfig(site: SiteKey): LoginProbeConfig {
    const probeDir = path.join(process.cwd(), 'config', 'login-probes');
    const commonPath = path.join(probeDir, 'common.json');
    const sitePath = path.join(probeDir, `${site}.json`);

    const defaultConfig: LoginProbeConfig = {
      thresholds: {
        logged_in: 2.5,
        not_logged_in: -1.5,
      },
      stability: {
        required_consistent_rounds: 2,
        poll_interval_ms: 2000,
      },
      positiveSignals: [
        { id: 'sidebar_visible', kind: 'selector_visible', selector: 'aside, [class*="sidebar"]', weight: 1.0 },
        {
          id: 'history_list_exists',
          kind: 'selector_exists',
          selector: '[class*="history"] li, [class*="conversation-list"] li',
          weight: 1.5,
        },
        { id: 'input_ready', kind: 'selector_visible', selector: 'textarea, [contenteditable="true"]', weight: 0.8 },
      ],
      negativeSignals: [
        { id: 'login_button_visible', kind: 'text_visible', texts: ['登录', 'log in', 'sign in'], weight: 1.5 },
        { id: 'login_url', kind: 'url_regex', pattern: '/login|/signin|passport|auth', weight: 2.0 },
      ],
    };

    const readPatch = (filePath: string): LoginProbeConfigPatch | null => {
      try {
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as LoginProbeConfigPatch;
      } catch {
        return null;
      }
    };

    const commonPatch = readPatch(commonPath);
    const sitePatch = readPatch(sitePath);

    const merged = {
      ...defaultConfig,
      ...(commonPatch ?? {}),
      ...(sitePatch ?? {}),
      thresholds: {
        ...defaultConfig.thresholds,
        ...(commonPatch?.thresholds ?? {}),
        ...(sitePatch?.thresholds ?? {}),
      },
      stability: {
        ...defaultConfig.stability,
        ...(commonPatch?.stability ?? {}),
        ...(sitePatch?.stability ?? {}),
      },
      positiveSignals:
        sitePatch?.positiveSignals
        ?? commonPatch?.positiveSignals
        ?? defaultConfig.positiveSignals,
      negativeSignals:
        sitePatch?.negativeSignals
        ?? commonPatch?.negativeSignals
        ?? defaultConfig.negativeSignals,
    };

    return merged;
  }

  private async probeLoginStatusWithStability(
    site: SiteKey,
    page: Page,
    config: LoginProbeConfig
  ): Promise<LoginProbeResult> {
    const rounds = Math.max(1, config.stability.required_consistent_rounds);
    const maxRounds = Math.max(rounds * 2, rounds + 1);

    let lastStatus: ProbeStatus | null = null;
    let stableCount = 0;
    let lastResult: LoginProbeResult = { status: 'unknown', score: 0, reasons: [] };

    for (let i = 0; i < maxRounds; i++) {
      const result = await this.probeLoginStatusOnce(site, page, config);
      lastResult = result;

      if (result.status === lastStatus) {
        stableCount++;
      } else {
        lastStatus = result.status;
        stableCount = 1;
      }

      if (stableCount >= rounds) {
        return result;
      }

      if (i < maxRounds - 1) {
        await new Promise((r) => setTimeout(r, Math.max(300, config.stability.poll_interval_ms)));
      }
    }

    return lastResult;
  }

  private async probeLoginStatusOnce(
    site: SiteKey,
    page: Page,
    config: LoginProbeConfig
  ): Promise<LoginProbeResult> {
    let score = 0;
    const reasons: string[] = [];

    for (const signal of config.positiveSignals) {
      const hit = await this.evaluateSignal(page, signal);
      if (hit) {
        score += signal.weight;
        reasons.push(`+${signal.id}`);
      }
    }

    for (const signal of config.negativeSignals) {
      const hit = await this.evaluateSignal(page, signal);
      if (hit) {
        score -= signal.weight;
        reasons.push(`-${signal.id}`);
      }
    }

    let status: ProbeStatus = 'unknown';
    if (score >= config.thresholds.logged_in) {
      status = 'logged_in';
    } else if (score <= config.thresholds.not_logged_in) {
      status = 'not_logged_in';
    }

    console.log(
      `[LoginProbe][${site}] status=${status} score=${score.toFixed(2)} reasons=${reasons.join(',') || '-'} url=${page.url()}`
    );

    return { status, score, reasons };
  }

  private async evaluateSignal(page: Page, signal: LoginProbeSignal): Promise<boolean> {
    try {
      return await page.evaluate((s: LoginProbeSignal) => {
        const g = globalThis as any;
        const doc = g.document as any;
        const getVisible = (selector: string): any[] => {
          const nodes = Array.from(doc.querySelectorAll(selector)) as any[];
          return nodes.filter((node) => {
            const style = g.getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          });
        };

        switch (s.kind) {
          case 'selector_exists':
            return !!(s.selector && doc.querySelector(s.selector));
          case 'selector_visible':
            return !!(s.selector && getVisible(s.selector).length > 0);
          case 'text_visible': {
            const texts = (s.texts ?? []).map((t) => t.toLowerCase());
            if (texts.length === 0) return false;
            const nodes = getVisible('a,button,[role="button"],span,div');
            return nodes.some((node) => {
              const text = (node.textContent || '').trim().toLowerCase();
              return text && texts.some((t) => text.includes(t));
            });
          }
          case 'url_regex':
            if (!s.pattern) return false;
            return new RegExp(s.pattern, 'i').test(g.location?.href || '');
          default:
            return false;
        }
      }, signal as any);
    } catch {
      return false;
    }
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
