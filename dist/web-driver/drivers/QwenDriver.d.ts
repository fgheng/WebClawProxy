import { Page } from 'playwright';
import { BaseDriver } from './BaseDriver';
export declare class QwenDriver extends BaseDriver {
    constructor(page: Page, options?: ConstructorParameters<typeof BaseDriver>[2]);
    /**
     * 检查是否已登录
     * 只在当前不在 Qwen 页面时才主动导航，避免重复刷新触发弹窗
     */
    isLoggedIn(): Promise<boolean>;
    createNewConversation(): Promise<void>;
    sendMessage(text: string): Promise<void>;
    extractResponse(): Promise<string>;
    isValidConversationUrl(url: string): boolean;
    protected getStopButtonSelector(): string | null;
    protected getResponseAreaSelector(): string | null;
    private dismissDialogs;
}
//# sourceMappingURL=QwenDriver.d.ts.map