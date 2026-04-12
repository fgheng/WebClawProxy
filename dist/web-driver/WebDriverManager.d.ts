import { SiteKey, InitConversationResult, ChatResult, WebDriverManagerOptions } from './types';
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
export declare class WebDriverManager {
    private options;
    private browser;
    private context;
    /** 每个 SiteKey 对应一个 Page 和 Driver */
    private pageMap;
    private driverMap;
    constructor(options?: WebDriverManagerOptions);
    /**
     * 对话初始化服务
     *
     * @param site 网站 key（gpt/qwen/deepseek/kimi）
     * @param initPrompt 初始化提示词（可选，默认从配置文件读取）
     * @returns 新建对话的 URL
     */
    initConversation(site: SiteKey, initPrompt?: string): Promise<InitConversationResult>;
    /**
     * 对话服务
     *
     * @param site 网站 key
     * @param sessionUrl 对话 session URL
     * @param message 要发送的消息
     * @returns 模型的响应内容
     */
    chat(site: SiteKey, sessionUrl: string, message: string): Promise<ChatResult>;
    /**
     * 浏览器弹出服务
     *
     * @param url 要打开的链接
     * @param hint 提示信息（可选）
     */
    openBrowser(url: string, hint?: string): Promise<void>;
    /**
     * 关闭浏览器，释放资源
     */
    close(): Promise<void>;
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
    private ensureBrowser;
    /**
     * 获取或创建指定 site 的 Driver
     */
    private getOrCreateDriver;
    /**
     * 确保用户已登录，如果没有登录则弹出浏览器等待登录
     */
    private ensureLoggedIn;
    /**
     * 等待对话 URL 从主页变成具体对话链接
     */
    private waitForConversationUrl;
}
//# sourceMappingURL=WebDriverManager.d.ts.map