import { Page, Browser, BrowserContext } from 'playwright';

/**
 * 支持的网站 key
 */
export type SiteKey = 'gpt' | 'qwen' | 'deepseek' | 'kimi';

/**
 * 对话初始化结果
 */
export interface InitConversationResult {
  /** 新建对话后获取到的 web 链接 */
  url: string;
}

/**
 * 对话结果
 */
export interface ChatResult {
  /** 模型输出的文本内容（已过滤思维链） */
  content: string;
}

/**
 * WebDriverManager 初始化选项
 */
export interface WebDriverManagerOptions {
  /** 是否无头模式，默认 false */
  headless?: boolean;
  /** 等待模型响应的超时时间（ms），默认 120000 */
  responseTimeoutMs?: number;
  /** 内容稳定检测间隔（ms），默认 500 */
  stabilityCheckIntervalMs?: number;
  /** 连续稳定次数才认为完成，默认 3 */
  stabilityCheckCount?: number;
  /** 登录态缓存有效期（ms），默认 10 分钟 */
  authCacheTtlMs?: number;
  /** 人工登录最长等待时间（ms），默认 5 分钟 */
  loginWaitTimeoutMs?: number;
  /** 人工登录轮询间隔（ms），默认 3 秒 */
  loginCheckIntervalMs?: number;
}

/**
 * Web 驱动接口，每个网站驱动必须实现该接口
 */
export interface IWebDriver {
  /** 判断是否已登录 */
  isLoggedIn(): Promise<boolean>;
  /** 点击新建对话按钮 */
  createNewConversation(): Promise<void>;
  /** 向对话框填入内容并发送 */
  sendMessage(text: string): Promise<void>;
  /** 等待模型回复完成 */
  waitForResponse(): Promise<void>;
  /** 提取模型的最终回复内容（不含思维链） */
  extractResponse(): Promise<string>;
  /** 获取当前对话的 URL */
  getConversationUrl(): Promise<string>;
  /** 跳转到指定对话 URL */
  navigateToConversation(url: string): Promise<void>;
  /** 判断指定的对话 URL 是否有效 */
  isValidConversationUrl(url: string): boolean;
}

/**
 * Web 驱动错误类型
 */
export enum WebDriverErrorCode {
  NOT_LOGGED_IN = 'NOT_LOGGED_IN',
  DIALOG_BLOCKED = 'DIALOG_BLOCKED',
  INVALID_SESSION_URL = 'INVALID_SESSION_URL',
  RESPONSE_TIMEOUT = 'RESPONSE_TIMEOUT',
  RESPONSE_EXTRACTION_FAILED = 'RESPONSE_EXTRACTION_FAILED',
  NEW_CONVERSATION_FAILED = 'NEW_CONVERSATION_FAILED',
  SEND_MESSAGE_FAILED = 'SEND_MESSAGE_FAILED',
  BROWSER_NOT_INITIALIZED = 'BROWSER_NOT_INITIALIZED',
  UNKNOWN_SITE = 'UNKNOWN_SITE',
}

/**
 * Web 驱动错误
 */
export class WebDriverError extends Error {
  constructor(
    public readonly code: WebDriverErrorCode,
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'WebDriverError';
  }
}
