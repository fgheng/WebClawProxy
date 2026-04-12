import { ClientConfig } from './types';
/**
 * 交互式 CLI 界面
 */
export declare class ChatCLI {
    private client;
    private rl;
    private isRunning;
    private isSending;
    private spinnerInterval;
    private roundCount;
    constructor(config: ClientConfig);
    start(): Promise<void>;
    private showWelcome;
    private showHelp;
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
}
//# sourceMappingURL=ChatCLI.d.ts.map