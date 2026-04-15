import { ClientConfig } from './types';
/**
 * 交互式 CLI 界面
 */
export declare class ChatCLI {
    private core;
    private rl;
    private isRunning;
    private isSending;
    private spinnerInterval;
    private roundCount;
    constructor(config: ClientConfig);
    start(): Promise<void>;
    private showWelcome;
    private showHistory;
    private showConfig;
    private handleCommand;
    private startSpinner;
    private stopSpinner;
    private printUserMessage;
    private printAssistantMessage;
    private printToolCalls;
    private printErrorMessage;
    private sendMessage;
    private getPromptString;
    private promptLoop;
    private quit;
    private renderCoreResult;
}
//# sourceMappingURL=ChatCLI.d.ts.map