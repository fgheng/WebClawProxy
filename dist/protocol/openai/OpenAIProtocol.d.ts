import { BaseProtocol } from '../BaseProtocol';
import { InternalRequest, InternalResponse } from '../types';
import { OpenAIResponse } from './types';
/**
 * OpenAI 协议转换器
 *
 * 负责将 OpenAI API 格式的请求转换为内部统一结构，
 * 以及将内部响应结构转换回 OpenAI API 格式。
 */
export declare class OpenAIProtocol extends BaseProtocol {
    private logProtocolTrace;
    /**
     * 将 OpenAI API 请求转换为内部统一结构
     *
     * 提取规则：
     * - MODEL    = input.model
     * - SYSTEM   = 提取 messages 中所有 role=system 的文本内容并按顺序拼接
     * - TOOLS    = input.tools || []
     * - CURRENT  = 按 V5 规则从尾段提取 user/tool 消息批次（仅 user/tool）
     * - HISTORY  = 非 system 消息去除 current 源片段后的前缀
     */
    parse(input: unknown, options?: {
        traceId?: string;
        source?: string;
    }): InternalRequest;
    private splitHistoryAndCurrent;
    /**
     * 将内部响应字段转换为 OpenAI API 格式
     */
    format(model: string, messagePayload: Pick<InternalResponse, 'content' | 'tool_calls' | 'finish_reason'>, usage?: InternalResponse['usage']): OpenAIResponse;
    private normalizeMessage;
    private extractTextContent;
}
//# sourceMappingURL=OpenAIProtocol.d.ts.map