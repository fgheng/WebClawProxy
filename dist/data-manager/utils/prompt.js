"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contentToString = contentToString;
exports.buildSystemPrompt = buildSystemPrompt;
exports.buildHistoryPrompt = buildHistoryPrompt;
exports.buildCurrentPrompt = buildCurrentPrompt;
exports.buildToolsPrompt = buildToolsPrompt;
exports.buildInitPrompt = buildInitPrompt;
exports.buildCurrentPromptForWebSend = buildCurrentPromptForWebSend;
function formatNonTextContentItem(item) {
    const { type, ...rest } = item;
    if (Object.keys(rest).length === 0) {
        return '';
    }
    try {
        return JSON.stringify(rest);
    }
    catch {
        return String(rest);
    }
}
function formatToolCallBlocks(toolCalls) {
    if (!toolCalls || toolCalls.length === 0) {
        return '';
    }
    return toolCalls
        .map((toolCall) => {
        const id = toolCall.id ?? '';
        const name = toolCall.function?.name ?? '';
        const args = toolCall.function?.arguments ?? '';
        return [`<tool_call id="${id}">`, `name: ${name}`, `arguments: ${args}`, '</tool_call>'].join('\n');
    })
        .join('\n');
}
/**
 * Prompt 构造工具函数集合
 * 负责将内部统一结构转换为各种 prompt 字符串
 */
/**
 * 将单条消息的 content 转换为纯文本字符串
 */
function contentToString(content) {
    if (typeof content === 'string') {
        return content;
    }
    if (!Array.isArray(content)) {
        return String(content ?? '');
    }
    return content
        .map((item) => {
        if (item.type === 'text') {
            return item.text ?? '';
        }
        return formatNonTextContentItem(item);
    })
        .join('\n');
}
/**
 * 构造 system prompt
 * 格式：
 * <|system|>
 * [system内容]
 */
function buildSystemPrompt(system) {
    if (!system)
        return '';
    return `<|system|>\n${system}`;
}
/**
 * 构造 history prompt
 * 格式：
 * <|role:user|>
 * 用户内容
 *
 * <|role:assistant|>
 * 助手内容
 */
function buildHistoryPrompt(history) {
    if (!history || history.length === 0)
        return '';
    return history
        .map((msg) => {
        const role = msg.role;
        if (role === 'system') {
            return '';
        }
        const contentStr = contentToString(msg.content);
        if (role === 'user') {
            return [`<|user|>`, contentStr].filter(Boolean).join('\n');
        }
        if (role === 'assistant') {
            const toolCallBlocks = formatToolCallBlocks(msg.tool_calls);
            return [`<|assistant|>`, contentStr, toolCallBlocks].filter(Boolean).join('\n');
        }
        if (role === 'tool') {
            const toolCallId = msg.tool_call_id;
            const toolHeader = toolCallId ? `<|tool| id="${toolCallId}">` : '<|tool|>';
            return [toolHeader, contentStr].filter(Boolean).join('\n');
        }
        return [`<|${role}|>`, contentStr].filter(Boolean).join('\n');
    })
        .filter(Boolean)
        .join('\n\n');
}
/**
 * 构造 current prompt
 * 只提取 content 内容，不带 role 标记
 */
function buildCurrentPrompt(current) {
    const contentStr = contentToString(current.content);
    const toolCallBlocks = formatToolCallBlocks(current.tool_calls);
    return [contentStr, toolCallBlocks].filter(Boolean).join('\n');
}
/**
 * 构造 tools prompt
 * 格式：
 * Tool 1
 * Name: xxx
 * Description: xxx
 * Parameters:
 * - param(type, required): description
 */
function buildToolsPrompt(tools) {
    if (!tools || tools.length === 0)
        return '';
    return tools
        .map((tool, index) => {
        const fn = tool.function;
        const lines = [
            `Tool ${index + 1}`,
            `Name: ${fn.name}`,
            `Description: ${fn.description ?? ''}`,
        ];
        if (fn.parameters?.properties) {
            lines.push('Parameters:');
            const required = fn.parameters.required ?? [];
            for (const [name, prop] of Object.entries(fn.parameters.properties)) {
                const type = prop.type ?? 'any';
                const isRequired = required.includes(name);
                const desc = prop.description ? `: ${prop.description}` : '';
                const reqStr = isRequired ? ', required' : '';
                lines.push(`- ${name}(${type}${reqStr})${desc}`);
            }
        }
        else {
            lines.push('Parameters: none');
        }
        return lines.join('\n');
    })
        .join('\n\n');
}
/**
 * 构造初始化 prompt
 * 使用模板替换各个占位符
 */
function buildInitPrompt(options) {
    const { template, responseSchemaTemplate, systemPrompt, toolsPrompt, historyPrompt } = options;
    return template
        .replace('{{response_schema_template}}', responseSchemaTemplate)
        .replace('{{system_prompt}}', systemPrompt)
        .replace('{{tools_prompt}}', toolsPrompt || '（无可用工具）')
        .replace('{{history_prompt}}', historyPrompt || '（无历史记录）');
}
/**
 * 构造发送到网页前的用户消息包装
 * - template 为空（或全空白）时，直接返回 currentPrompt
 * - 非空时用 {{content}} 替换当前消息；若未出现占位符，则按原样返回模板
 */
function buildCurrentPromptForWebSend(options) {
    const { template, currentPrompt } = options;
    const normalizedTemplate = (template ?? '').trim();
    if (!normalizedTemplate) {
        return currentPrompt;
    }
    return normalizedTemplate.split('{{content}}').join(currentPrompt);
}
//# sourceMappingURL=prompt.js.map