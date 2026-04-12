/**
 * 终端颜色与格式化工具
 */
export declare const COLORS: {
    readonly reset: "\u001B[0m";
    readonly bold: "\u001B[1m";
    readonly dim: "\u001B[2m";
    readonly italic: "\u001B[3m";
    readonly underline: "\u001B[4m";
    readonly black: "\u001B[30m";
    readonly red: "\u001B[31m";
    readonly green: "\u001B[32m";
    readonly yellow: "\u001B[33m";
    readonly blue: "\u001B[34m";
    readonly magenta: "\u001B[35m";
    readonly cyan: "\u001B[36m";
    readonly white: "\u001B[37m";
    readonly gray: "\u001B[90m";
    readonly brightRed: "\u001B[91m";
    readonly brightGreen: "\u001B[92m";
    readonly brightYellow: "\u001B[93m";
    readonly brightBlue: "\u001B[94m";
    readonly brightMagenta: "\u001B[95m";
    readonly brightCyan: "\u001B[96m";
    readonly brightWhite: "\u001B[97m";
    readonly bgBlue: "\u001B[44m";
    readonly bgGreen: "\u001B[42m";
    readonly bgYellow: "\u001B[43m";
    readonly bgRed: "\u001B[41m";
};
type ColorKey = keyof typeof COLORS;
/** 给文字着色 */
export declare function colorize(text: string, ...colors: ColorKey[]): string;
/** 获取终端宽度（默认 80） */
export declare function getTerminalWidth(): number;
/** 打印水平分隔线 */
export declare function printSeparator(char?: string, color?: ColorKey): void;
/** 打印带边框的标题行 */
export declare function printHeader(title: string): void;
/**
 * 格式化助手回复内容用于终端显示
 * 支持基本的 Markdown 渲染：粗体、代码块等
 */
export declare function formatAssistantContent(content: string): string;
/**
 * 包装长文本（超出终端宽度时换行）
 * 注意：不影响 ANSI 代码
 */
export declare function wrapText(text: string, maxWidth?: number): string;
export {};
//# sourceMappingURL=display.d.ts.map