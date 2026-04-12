import { Page } from 'playwright';
import { IWebDriver } from '../types';
/**
 * Web 驱动抽象基类
 * 每个网站驱动继承自该基类，实现特定网站的选择器和行为
 * 基类提供通用逻辑：多重回复检测策略、导航等
 */
export declare abstract class BaseDriver implements IWebDriver {
    protected page: Page;
    protected baseUrl: string;
    protected responseTimeoutMs: number;
    protected stabilityCheckIntervalMs: number;
    protected stabilityCheckCount: number;
    constructor(page: Page, baseUrl: string, options?: {
        responseTimeoutMs?: number;
        stabilityCheckIntervalMs?: number;
        stabilityCheckCount?: number;
    });
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
    /** 获取当前对话的 URL */
    getConversationUrl(): Promise<string>;
    /** 跳转到指定对话 URL */
    navigateToConversation(url: string): Promise<void>;
    /**
     * 等待模型回复完成 - 多重检测策略
     *
     * 策略说明：
     * - 优先使用「停止按钮消失」检测（准确性高，DeepSeek 生成时有明显的停止按钮）
     * - 如果停止按钮检测成功，追加一个小等待（500ms）确保 DOM 已最终刷新
     * - 如果停止按钮检测不可用（返回 null selector），fallback 到「内容稳定性」检测
     * - 两种检测方式都会在超时时抛出错误
     */
    waitForResponse(): Promise<void>;
    /**
     * 检测策略 0：复制按钮就绪检测（跨站点统一）
     * 条件：复制按钮可见，且（若配置了 responseSelector）最后一条回复非空并稳定
     */
    protected waitByCopyButtonReady(): Promise<void>;
    /**
     * 检测策略 1：发送按钮状态检测
     * 等待"停止"按钮消失（即发送按钮恢复）
     * 注意：需要先等待停止按钮出现，再等待其消失，避免误判
     */
    protected waitBySendButtonRestore(): Promise<void>;
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
    protected waitByContentStability(): Promise<void>;
    /** 返回复制按钮的 CSS 选择器（用于回复完成判定），子类不支持可返回 null */
    protected getCopyButtonSelector(): string | null;
    /** 返回停止按钮的 CSS 选择器，子类如果没有停止按钮可返回 null */
    protected getStopButtonSelector(): string | null;
    /** 返回响应区域的 CSS 选择器，用于内容稳定性检测 */
    protected getResponseAreaSelector(): string | null;
    protected sleep(ms: number): Promise<void>;
    /**
     * 填充文本到输入框（支持大段文本，使用 clipboard 方式避免速度慢）
     */
    protected fillTextInput(selector: string, text: string): Promise<void>;
}
//# sourceMappingURL=BaseDriver.d.ts.map