"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIProtocol = void 0;
const BaseProtocol_1 = require("../BaseProtocol");
const types_1 = require("../types");
const uuid_1 = require("uuid");
/**
 * OpenAI 协议转换器
 *
 * 负责将 OpenAI API 格式的请求转换为内部统一结构，
 * 以及将内部响应结构转换回 OpenAI API 格式。
 */
class OpenAIProtocol extends BaseProtocol_1.BaseProtocol {
    logProtocolTrace(traceId, stage, payload) {
        try {
            console.log(`[ProtocolTrace][${traceId}] stage=${stage} payload=${JSON.stringify(payload)}`);
        }
        catch {
            console.log(`[ProtocolTrace][${traceId}] stage=${stage} payload=[unserializable]`);
        }
    }
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
    parse(input, options) {
        const traceId = options?.traceId ?? `proto-${(0, uuid_1.v4)().replace(/-/g, '').slice(0, 8)}`;
        const source = options?.source ?? 'unknown';
        const req = input;
        // 校验必填字段
        if (!req || typeof req !== 'object') {
            throw new types_1.ProtocolParseError(types_1.ProtocolType.OPENAI, 'OpenAI 请求格式无效：不是一个对象');
        }
        if (!req.model || typeof req.model !== 'string') {
            throw new types_1.ProtocolParseError(types_1.ProtocolType.OPENAI, 'OpenAI 请求缺少 model 字段');
        }
        if (!Array.isArray(req.messages)) {
            throw new types_1.ProtocolParseError(types_1.ProtocolType.OPENAI, 'OpenAI 请求 messages 字段必须是数组');
        }
        // 1. 提取 MODEL
        const model = req.model;
        this.logProtocolTrace(traceId, 'input_overview', {
            source,
            model,
            message_count: req.messages.length,
            roles: req.messages.map((m) => m.role),
            has_tools: Array.isArray(req.tools),
            tools_count: Array.isArray(req.tools) ? req.tools.length : 0,
        });
        // 2. 提取 SYSTEM
        let system = '';
        if (req.messages.length > 0 && req.messages[0].role === 'system') {
            system = this.extractTextContent(req.messages[0]);
        }
        // 3. 仅剔除第 0 条 system 消息，构造消息序列
        const normalizedMessages = req.messages.map((m) => this.normalizeMessage(m));
        const messagesWithoutLeadingSystem = normalizedMessages.length > 0 && normalizedMessages[0].role === 'system'
            ? normalizedMessages.slice(1)
            : normalizedMessages;
        this.logProtocolTrace(traceId, 'after_leading_system_trim', {
            source,
            removed_leading_system: normalizedMessages.length > 0 && normalizedMessages[0].role === 'system',
            normalized_count: normalizedMessages.length,
            after_trim_count: messagesWithoutLeadingSystem.length,
            after_trim_roles: messagesWithoutLeadingSystem.map((m) => m.role),
        });
        // 4. 提取 TOOLS
        const tools = Array.isArray(req.tools) ? req.tools : [];
        // 5. 提取 CURRENT（最后一条消息，从 HISTORY 中移除）
        if (messagesWithoutLeadingSystem.length === 0) {
            throw new types_1.ProtocolParseError(types_1.ProtocolType.OPENAI, 'OpenAI 请求 messages 中没有可用消息');
        }
        const history = messagesWithoutLeadingSystem.slice(0, -1);
        const current = messagesWithoutLeadingSystem[messagesWithoutLeadingSystem.length - 1];
        this.logProtocolTrace(traceId, 'split_history_current', {
            source,
            model,
            history_count: history.length,
            history_roles: history.map((m) => m.role),
            current_role: current.role,
            current_content_type: Array.isArray(current.content) ? 'array' : typeof current.content,
            current_has_tool_calls: Array.isArray(current.tool_calls) && current.tool_calls.length > 0,
            tools_count: tools.length,
        });
        return {
            model,
            system,
            history,
            tools,
            current,
        };
    }
    /**
     * 将内部响应字段转换为 OpenAI API 格式
     */
    format(model, messagePayload, usage) {
        const now = Math.floor(Date.now() / 1000);
        const id = `chatcmpl-${(0, uuid_1.v4)().replace(/-/g, '').substring(0, 20)}`;
        const message = {
            role: 'assistant',
            content: messagePayload.content ?? null,
        };
        if (messagePayload.tool_calls && messagePayload.tool_calls.length > 0) {
            message.tool_calls = messagePayload.tool_calls.map((tc) => ({
                id: tc.id ?? `call_${(0, uuid_1.v4)().replace(/-/g, '').substring(0, 20)}`,
                type: tc.type ?? 'function',
                function: tc.function,
                index: tc.index ?? 0,
            }));
        }
        const finishReason = messagePayload.finish_reason ??
            (messagePayload.tool_calls && messagePayload.tool_calls.length > 0
                ? 'tool_calls'
                : 'stop');
        return {
            id,
            object: 'chat.completion',
            created: now,
            model: model || 'unknown',
            choices: [
                {
                    index: 0,
                    message,
                    logprobs: null,
                    finish_reason: finishReason,
                },
            ],
            usage: {
                prompt_tokens: usage?.prompt_tokens ?? 0,
                completion_tokens: usage?.completion_tokens ?? 0,
                total_tokens: usage?.total_tokens ??
                    (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0),
            },
        };
    }
    normalizeMessage(msg) {
        let content;
        if (typeof msg.content === 'string') {
            content = msg.content;
        }
        else if (Array.isArray(msg.content)) {
            content = msg.content;
        }
        else if (msg.content === null || msg.content === undefined) {
            content = '';
        }
        else {
            content = String(msg.content);
        }
        return {
            role: msg.role,
            content,
            tool_calls: Array.isArray(msg.tool_calls)
                ? msg.tool_calls.map((tc) => ({
                    index: tc.index,
                    id: tc.id,
                    type: tc.type,
                    function: tc.function,
                }))
                : undefined,
        };
    }
    extractTextContent(msg) {
        if (typeof msg.content === 'string') {
            return msg.content;
        }
        if (Array.isArray(msg.content)) {
            return msg.content
                .filter((item) => item.type === 'text')
                .map((item) => item.text ?? '')
                .join('\n');
        }
        return '';
    }
}
exports.OpenAIProtocol = OpenAIProtocol;
//# sourceMappingURL=OpenAIProtocol.js.map