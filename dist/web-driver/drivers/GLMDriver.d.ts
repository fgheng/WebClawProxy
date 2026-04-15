import { Page } from 'playwright';
import { BaseDriver } from './BaseDriver';
export declare class GLMDriver extends BaseDriver {
    constructor(page: Page, options?: ConstructorParameters<typeof BaseDriver>[2]);
    isLoggedIn(): Promise<boolean>;
    createNewConversation(): Promise<void>;
    sendMessage(text: string): Promise<void>;
    extractResponse(): Promise<string>;
    isValidConversationUrl(url: string): boolean;
    protected getStopButtonSelector(): string | null;
    protected getResponseAreaSelector(): string | null;
    navigateToConversation(url: string): Promise<void>;
    private getInputText;
    private canonicalizeForDispatch;
    private clearInputArea;
    private fillInputRobustly;
    private waitForSendButtonStateAfterFill;
    private tryPrimarySend;
    private tryFallbackSend;
    private waitForDispatch;
}
//# sourceMappingURL=GLMDriver.d.ts.map