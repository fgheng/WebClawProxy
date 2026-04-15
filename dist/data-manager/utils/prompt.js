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
function wrapBlock(tag, content) {
    const normalized = content.trim();
    if (!normalized)
        return '';
    return [`<${tag}>`, normalized, `</${tag}>`].join('\n');
}
function formatCurrentMessage(msg) {
    const contentStr = contentToString(msg.content);
    if (msg.role === 'tool') {
        const toolHeader = msg.tool_call_id ? `<tool id="${msg.tool_call_id}">` : '<tool>';
        return [toolHeader, contentStr].filter(Boolean).join('\n');
    }
    if (msg.role === 'user') {
        return ['<user>', contentStr].filter(Boolean).join('\n');
    }
    if (msg.role === 'assistant') {
        const toolCallBlocks = formatToolCallBlocks(msg.tool_calls);
        return ['<assistant>', contentStr, toolCallBlocks].filter(Boolean).join('\n');
    }
    const toolCallBlocks = formatToolCallBlocks(msg.tool_calls);
    return [`<${msg.role}>`, contentStr, toolCallBlocks].filter(Boolean).join('\n');
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
 * <system>
 * [system内容]
 * </system>
 */
function buildSystemPrompt(system) {
    if (!system.trim())
        return '';
    return wrapBlock('system', system);
}
/**
 * 构造 history prompt
 * 格式：
 * <user>
 * 用户内容
 *
 * <assistant>
 * 助手内容
 */
function buildHistoryPrompt(history) {
    if (!history || history.length === 0)
        return '';
    const entries = history
        .map((msg) => {
        const role = msg.role;
        if (role === 'system') {
            return '';
        }
        const contentStr = contentToString(msg.content);
        if (role === 'user') {
            return ['<user>', contentStr].filter(Boolean).join('\n');
        }
        if (role === 'assistant') {
            const toolCallBlocks = formatToolCallBlocks(msg.tool_calls);
            return ['<assistant>', contentStr, toolCallBlocks].filter(Boolean).join('\n');
        }
        if (role === 'tool') {
            const toolCallId = msg.tool_call_id;
            const toolHeader = toolCallId ? `<tool id="${toolCallId}">` : '<tool>';
            return [toolHeader, contentStr].filter(Boolean).join('\n');
        }
        return [`<${role}>`, contentStr].filter(Boolean).join('\n');
    })
        .filter(Boolean)
        .join('\n\n');
    return wrapBlock('history', entries);
}
/**
 * 构造 current prompt
 * 只提取 content 内容，不带 role 标记
 */
function buildCurrentPrompt(current) {
    const currentList = current;
    if (!currentList.length)
        return '';
    if (currentList.length === 1 &&
        currentList[0].role === 'user' &&
        (!currentList[0].tool_calls || currentList[0].tool_calls.length === 0)) {
        return contentToString(currentList[0].content);
    }
    return currentList
        .map((msg) => formatCurrentMessage(msg))
        .filter(Boolean)
        .join('\n\n');
}
/**
 * 构造 tools prompt
 * 格式：
 * <tools>
 * <tool>
 * name: xxx
 * description: xxx
 * parameters:
 * - param(type, required): description
 * </tool>
 * </tools>
 */
function buildToolsPrompt(tools) {
    if (!tools || tools.length === 0)
        return '';
    const toolBlocks = tools
        .map((tool) => {
        const fn = tool.function;
        const lines = [
            `name: ${fn.name}`,
            `description: ${fn.description ?? ''}`,
        ];
        if (fn.parameters?.properties) {
            lines.push('parameters:');
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
            lines.push('parameters: none');
        }
        return wrapBlock('tool', lines.join('\n'));
    })
        .filter(Boolean)
        .join('\n\n');
    return wrapBlock('tools', toolBlocks);
}
function normalizePromptLayout(text) {
    return text
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
/**
 * 构造初始化 prompt
 * 使用模板替换各个占位符
 */
function buildInitPrompt(options) {
    const { template, initPrompt, responseSchemaTemplate, systemPrompt, toolsPrompt, historyPrompt } = options;
    const rendered = template
        .split('{{init_prompt}}').join(initPrompt)
        .split('{{response_schema_template}}').join(responseSchemaTemplate)
        .split('{{system_prompt}}').join(systemPrompt)
        .split('{{tools_prompt}}').join(toolsPrompt)
        .split('{{history_prompt}}').join(historyPrompt);
    return normalizePromptLayout(rendered);
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