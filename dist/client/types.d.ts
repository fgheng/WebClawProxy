/**
 * 客户端配置
 */
export interface ClientConfig {
    /** 服务地址，如 http://localhost:3000 */
    baseUrl: string;
    /** 使用的模型 */
    model: string;
    /** 系统提示词（可选） */
    system?: string;
    /** 请求超时（ms） */
    timeoutMs?: number;
    /** 客户端会话标识（用于问题排查） */
    sessionId?: string;
    /** 是否开启客户端链路日志 */
    traceEnabled?: boolean;
    /** 日志中响应内容预览长度 */
    tracePreviewChars?: number;
}
/**
 * 客户端内部对话消息
 */
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
/**
 * OpenAI 格式请求体
 */
export interface OpenAIRequestBody {
    model: string;
    messages: ChatMessage[];
    stream?: boolean;
}
/**
 * OpenAI 格式响应体
 */
export interface OpenAIResponseBody {
    id?: string;
    object?: string;
    created?: number;
    model?: string;
    choices?: {
        index?: number;
        message?: {
            role?: string;
            content?: string | null;
            tool_calls?: unknown[];
        };
        finish_reason?: string;
    }[];
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
    error?: {
        message?: string;
        type?: string;
        code?: string;
    };
}
/**
 * 客户端指令枚举
 */
export type ClientCommand = '/help' | '/quit' | '/exit' | '/clear' | '/model' | '/system' | '/history' | '/config' | '/trace' | '/reset';
//# sourceMappingURL=types.d.ts.map