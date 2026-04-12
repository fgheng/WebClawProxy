import { Message, Tool, ContentItem } from '../../../src/protocol/types';
/**
 * Prompt 构造工具函数集合
 * 负责将内部统一结构转换为各种 prompt 字符串
 */
/**
 * 将单条消息的 content 转换为纯文本字符串
 */
export declare function contentToString(content: string | ContentItem[]): string;
/**
 * 构造 system prompt
 * 格式：
 * <|system|>
 * [system内容]
 */
export declare function buildSystemPrompt(system: string): string;
/**
 * 构造 history prompt
 * 格式：
 * <|role:user|>
 * 用户内容
 *
 * <|role:assistant|>
 * 助手内容
 */
export declare function buildHistoryPrompt(history: Message[]): string;
/**
 * 构造 current prompt
 * 只提取 content 内容，不带 role 标记
 */
export declare function buildCurrentPrompt(current: Message): string;
/**
 * 构造 tools prompt
 * 格式：
 * Tool 1
 * Name: xxx
 * Description: xxx
 * Parameters:
 * - param(type, required): description
 */
export declare function buildToolsPrompt(tools: Tool[]): string;
/**
 * 构造初始化 prompt
 * 使用模板替换各个占位符
 */
export declare function buildInitPrompt(options: {
    template: string;
    responseSchemaTemplate: string;
    systemPrompt: string;
    toolsPrompt: string;
    historyPrompt: string;
}): string;
/**
 * 构造带模板的 current prompt
 */
export declare function buildCurrentPromptWithTemplate(options: {
    template: string;
    responseSchemaTemplate: string;
    currentPrompt: string;
}): string;
/**
 * 构造发送到网页前的用户消息包装
 * - template 为空（或全空白）时，直接返回 currentPrompt
 * - 非空时用 {{content}} 替换当前消息；若未出现占位符，则按原样返回模板
 */
export declare function buildCurrentPromptForWebSend(options: {
    template?: string;
    currentPrompt: string;
}): string;
//# sourceMappingURL=prompt.d.ts.map