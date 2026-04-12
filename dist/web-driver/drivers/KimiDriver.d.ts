import { Page } from 'playwright';
import { BaseDriver } from './BaseDriver';
export declare class KimiDriver extends BaseDriver {
    constructor(page: Page, options?: ConstructorParameters<typeof BaseDriver>[2]);
    isLoggedIn(): Promise<boolean>;
    createNewConversation(): Promise<void>;
    sendMessage(text: string): Promise<void>;
    extractResponse(): Promise<string>;
    isValidConversationUrl(url: string): boolean;
    protected getStopButtonSelector(): string | null;
    protected getResponseAreaSelector(): string | null;
    private dismissDialogs;
}
//# sourceMappingURL=KimiDriver.d.ts.map