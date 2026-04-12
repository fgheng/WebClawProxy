import { Page } from 'playwright';
import { BaseDriver } from './BaseDriver';
export declare class DeepSeekDriver extends BaseDriver {
    constructor(page: Page, options?: ConstructorParameters<typeof BaseDriver>[2]);
    /**
     * 检查是否已登录
     *
     * 重要：此方法不主动导航，只检查当前页面状态。
     * 首次检查时如果当前不在 DeepSeek 页面，才会导航到主页。
     * 这样可以避免每次调用都触发页面跳转导致 DeepSeek 弹出新对话框。
     */
    isLoggedIn(): Promise<boolean>;
    createNewConversation(): Promise<void>;
    sendMessage(text: string): Promise<void>;
    extractResponse(): Promise<string>;
    isValidConversationUrl(url: string): boolean;
    protected getCopyButtonSelector(): string | null;
    protected getStopButtonSelector(): string | null;
    protected getResponseAreaSelector(): string | null;
    private dismissDialogs;
}
//# sourceMappingURL=DeepSeekDriver.d.ts.map