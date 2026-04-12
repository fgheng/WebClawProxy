import { ClientConfig, ChatMessage, AssistantResponse } from './types';
/**
 * WebClawProxy 客户端 API 层
 * 负责构造 OpenAI 协议格式请求并与服务端通信
 */
export declare class WebClawClient {
    private config;
    private messages;
    private requestSeq;
    constructor(config: ClientConfig);
    /** 设置系统提示词（会清空历史） */
    setSystem(system: string): void;
    /** 切换模型（会清空历史） */
    setModel(model: string): void;
    /** 开关 trace 日志 */
    setTraceEnabled(enabled: boolean): void;
    isTraceEnabled(): boolean;
    /** 清空对话历史 */
    clearHistory(): void;
    /** 获取当前对话历史（不含 system） */
    getHistory(): ChatMessage[];
    /** 获取当前配置 */
    getConfig(): Required<ClientConfig>;
    /**
     * 发送用户消息，返回助手回复（文本与工具调用分离）
     */
    sendMessage(userContent: string): Promise<AssistantResponse>;
    listModels(): Promise<string[]>;
    healthCheck(): Promise<boolean>;
    private post;
    private get;
    private extractAssistantResponse;
    private buildDefaultSessionId;
    private buildTraceId;
    private preview;
    private logTrace;
}
//# sourceMappingURL=WebClawClient.d.ts.map