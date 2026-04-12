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
     * - SYSTEM   = 若 messages[0].role === 'system'，取其 content；否则为空
     * - HISTORY  = 仅剔除第 0 条 system 消息后，再去掉最后一条
     * - TOOLS    = input.tools || []
     * - CURRENT  = 处理后消息列表的最后一条
     */
    parse(input: unknown, options?: {
        traceId?: string;
        source?: string;
    }): InternalRequest;
    /**
     * 将内部响应字段转换为 OpenAI API 格式
     */
    format(model: string, messagePayload: Pick<InternalResponse, 'content' | 'tool_calls' | 'finish_reason'>, usage?: InternalResponse['usage']): OpenAIResponse;
    private normalizeMessage;
    private extractTextContent;
}
//# sourceMappingURL=OpenAIProtocol.d.ts.map