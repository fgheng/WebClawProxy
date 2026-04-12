"use strict";
/**
 * 终端颜色与格式化工具
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLORS = void 0;
exports.colorize = colorize;
exports.getTerminalWidth = getTerminalWidth;
exports.printSeparator = printSeparator;
exports.printHeader = printHeader;
exports.formatAssistantContent = formatAssistantContent;
exports.wrapText = wrapText;
// ANSI 颜色代码
exports.COLORS = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    italic: '\x1b[3m',
    underline: '\x1b[4m',
    // 前景色
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    // 亮色
    brightRed: '\x1b[91m',
    brightGreen: '\x1b[92m',
    brightYellow: '\x1b[93m',
    brightBlue: '\x1b[94m',
    brightMagenta: '\x1b[95m',
    brightCyan: '\x1b[96m',
    brightWhite: '\x1b[97m',
    // 背景色
    bgBlue: '\x1b[44m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgRed: '\x1b[41m',
};
/** 给文字着色 */
function colorize(text, ...colors) {
    const prefix = colors.map((c) => exports.COLORS[c]).join('');
    return `${prefix}${text}${exports.COLORS.reset}`;
}
/** 获取终端宽度（默认 80） */
function getTerminalWidth() {
    return process.stdout.columns ?? 80;
}
/** 打印水平分隔线 */
function printSeparator(char = '─', color = 'gray') {
    const width = Math.min(getTerminalWidth(), 80);
    console.log(colorize(char.repeat(width), color));
}
/** 打印带边框的标题行 */
function printHeader(title) {
    const width = Math.min(getTerminalWidth(), 80);
    const inner = ` ${title} `;
    const padLen = Math.max(0, width - inner.length);
    const left = Math.floor(padLen / 2);
    const right = padLen - left;
    const line = '═'.repeat(left) + inner + '═'.repeat(right);
    console.log(colorize(line, 'cyan', 'bold'));
}
/**
 * 格式化助手回复内容用于终端显示
 * 支持基本的 Markdown 渲染：粗体、代码块等
 */
function formatAssistantContent(content) {
    if (!content)
        return colorize('（空回复）', 'gray');
    const lines = content.split('\n');
    let inCodeBlock = false;
    let codeBlockLang = '';
    const formatted = [];
    for (const line of lines) {
        // 代码块开始/结束
        const codeBlockMatch = line.match(/^```(\w*)$/);
        if (codeBlockMatch) {
            if (!inCodeBlock) {
                inCodeBlock = true;
                codeBlockLang = codeBlockMatch[1] || '';
                const langLabel = codeBlockLang ? ` (${codeBlockLang})` : '';
                formatted.push(colorize(`┌─ 代码${langLabel} ─`, 'gray'));
            }
            else {
                inCodeBlock = false;
                formatted.push(colorize('└─────────', 'gray'));
            }
            continue;
        }
        if (inCodeBlock) {
            // 代码块内容：黄色前景
            formatted.push(colorize('│ ', 'gray') + colorize(line, 'brightYellow'));
        }
        else {
            // 处理内联 Markdown
            let processed = line;
            // 粗体 **text** 或 __text__
            processed = processed.replace(/\*\*(.+?)\*\*/g, (_, t) => colorize(t, 'bold', 'white'));
            processed = processed.replace(/__(.+?)__/g, (_, t) => colorize(t, 'bold', 'white'));
            // 斜体 *text* 或 _text_
            processed = processed.replace(/\*([^*]+)\*/g, (_, t) => colorize(t, 'italic'));
            processed = processed.replace(/_([^_]+)_/g, (_, t) => colorize(t, 'italic'));
            // 行内代码 `code`
            processed = processed.replace(/`([^`]+)`/g, (_, t) => colorize(t, 'brightYellow'));
            // 标题行 # ## ###
            if (/^#{1,3}\s/.test(processed)) {
                processed = colorize(processed, 'cyan', 'bold');
            }
            // 列表项
            if (/^[-*]\s/.test(processed)) {
                processed = colorize('●', 'cyan') + processed.slice(1);
            }
            else if (/^\d+\.\s/.test(processed)) {
                processed = colorize(processed.replace(/^(\d+)\./, '$1.'), 'cyan');
            }
            formatted.push(processed);
        }
    }
    return formatted.join('\n');
}
/**
 * 包装长文本（超出终端宽度时换行）
 * 注意：不影响 ANSI 代码
 */
function wrapText(text, maxWidth) {
    const width = maxWidth ?? Math.min(getTerminalWidth() - 4, 100);
    // 简单处理：如果行长度超过 width，尝试在合适位置换行
    return text
        .split('\n')
        .map((line) => {
        // 移除 ANSI 代码后计算实际长度
        const plainLen = line.replace(/\x1b\[[0-9;]*m/g, '').length;
        if (plainLen <= width)
            return line;
        // 超长行：简单截断（不破坏 ANSI 代码）
        return line;
    })
        .join('\n');
}
//# sourceMappingURL=display.js.map