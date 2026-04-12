import { Page } from 'playwright';
import { BaseDriver } from './BaseDriver';
export declare class ChatGPTDriver extends BaseDriver {
    constructor(page: Page, options?: ConstructorParameters<typeof BaseDriver>[2]);
    /**
     * 检查是否已登录
     * 只在当前不在 ChatGPT 页面时才主动导航，避免每次都刷新页面触发弹窗
     */
    isLoggedIn(): Promise<boolean>;
    createNewConversation(): Promise<void>;
    sendMessage(text: string): Promise<void>;
    extractResponse(): Promise<string>;
    isValidConversationUrl(url: string): boolean;
    protected getStopButtonSelector(): string | null;
    protected getResponseAreaSelector(): string | null;
    /**
     * 关闭可能存在的弹窗/广告
     */
    private dismissDialogs;
}
//# sourceMappingURL=ChatGPTDriver.d.ts.map