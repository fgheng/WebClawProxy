"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatCLI = void 0;
const readline = __importStar(require("readline"));
const WebClawClient_1 = require("./WebClawClient");
const display_1 = require("./utils/display");
/**
 * 交互式 CLI 界面
 */
class ChatCLI {
    constructor(config) {
        this.isRunning = false;
        this.isSending = false;
        this.spinnerInterval = null;
        this.roundCount = 0;
        this.client = new WebClawClient_1.WebClawClient(config);
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true,
        });
        // 监听 Ctrl+C
        this.rl.on('SIGINT', () => {
            if (this.isSending) {
                console.log('\n' + (0, display_1.colorize)('⚠ 消息发送中，请等待响应完成...', 'yellow'));
            }
            else {
                this.quit();
            }
        });
    }
    async start() {
        this.isRunning = true;
        await this.showWelcome();
        this.promptLoop();
    }
    async showWelcome() {
        console.clear();
        (0, display_1.printHeader)('WebClawProxy 客户端');
        const cfg = this.client.getConfig();
        console.log((0, display_1.colorize)('  服务地址：', 'gray') + (0, display_1.colorize)(cfg.baseUrl, 'cyan') +
            (0, display_1.colorize)('    模型：', 'gray') + (0, display_1.colorize)(cfg.model, 'brightGreen'));
        if (cfg.system) {
            const preview = cfg.system.length > 60 ? cfg.system.substring(0, 57) + '...' : cfg.system;
            console.log((0, display_1.colorize)('  系统提示：', 'gray') + (0, display_1.colorize)(preview, 'yellow'));
        }
        console.log((0, display_1.colorize)('  会话ID：', 'gray') + (0, display_1.colorize)(cfg.sessionId, 'brightCyan') +
            (0, display_1.colorize)('    Trace：', 'gray') + (0, display_1.colorize)(cfg.traceEnabled ? 'ON' : 'OFF', cfg.traceEnabled ? 'green' : 'yellow'));
        (0, display_1.printSeparator)();
        console.log((0, display_1.colorize)('  输入消息开始对话，输入 /help 查看所有命令', 'gray'));
        (0, display_1.printSeparator)();
        process.stdout.write((0, display_1.colorize)('  正在连接服务...', 'gray'));
        const alive = await this.client.healthCheck();
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        if (alive) {
            console.log((0, display_1.colorize)('  ✓ 服务已连接', 'green'));
        }
        else {
            console.log((0, display_1.colorize)('  ✗ 服务未响应（请先运行 npm run dev 启动服务）', 'red'));
            console.log((0, display_1.colorize)('  提示：可继续输入，连接成功后自动生效', 'gray'));
        }
        console.log();
    }
    showHelp() {
        (0, display_1.printSeparator)('─', 'gray');
        console.log((0, display_1.colorize)('  可用命令：', 'cyan', 'bold'));
        const commands = [
            ['/help', '显示此帮助信息'],
            ['/clear', '清空对话历史，开始新对话'],
            ['/reset', '清空对话历史并重置系统提示词'],
            ['/model <name>', '切换模型（自动清空对话历史）'],
            ['/system <text>', '设置系统提示词（自动清空历史）'],
            ['/trace [on|off]', '查看或开关客户端 trace 日志'],
            ['/history', '显示当前对话历史'],
            ['/config', '显示当前配置信息'],
            ['/quit  /exit', '退出客户端'],
        ];
        commands.forEach(([cmd, desc]) => {
            console.log('  ' + (0, display_1.colorize)(cmd.padEnd(22), 'brightYellow') + (0, display_1.colorize)(desc, 'gray'));
        });
        (0, display_1.printSeparator)('─', 'gray');
    }
    showHistory() {
        const history = this.client.getHistory();
        if (history.length === 0) {
            console.log((0, display_1.colorize)('  （对话历史为空）', 'gray'));
            return;
        }
        (0, display_1.printSeparator)('─', 'gray');
        console.log((0, display_1.colorize)(`  当前对话历史（共 ${history.length} 条）：`, 'cyan', 'bold'));
        (0, display_1.printSeparator)('─', 'gray');
        history.forEach((msg, i) => {
            const roleLabel = msg.role === 'user' ? '你' : 'AI';
            const roleColor = msg.role === 'user' ? 'brightBlue' : 'brightMagenta';
            const preview = typeof msg.content === 'string' && msg.content.length > 100
                ? msg.content.substring(0, 97) + '...'
                : msg.content;
            console.log((0, display_1.colorize)(`  [${i + 1}] ${roleLabel}: `, roleColor, 'bold') +
                (0, display_1.colorize)(String(preview), 'gray'));
        });
        (0, display_1.printSeparator)('─', 'gray');
    }
    showConfig() {
        const cfg = this.client.getConfig();
        const history = this.client.getHistory();
        (0, display_1.printSeparator)('─', 'gray');
        console.log((0, display_1.colorize)('  当前配置：', 'cyan', 'bold'));
        console.log((0, display_1.colorize)('  服务地址：', 'gray') + (0, display_1.colorize)(cfg.baseUrl, 'cyan'));
        console.log((0, display_1.colorize)('  当前模型：', 'gray') + (0, display_1.colorize)(cfg.model, 'brightGreen'));
        console.log((0, display_1.colorize)('  会话ID：', 'gray') + (0, display_1.colorize)(cfg.sessionId, 'brightCyan'));
        console.log((0, display_1.colorize)('  Trace日志：', 'gray') +
            (0, display_1.colorize)(cfg.traceEnabled ? '开启' : '关闭', cfg.traceEnabled ? 'green' : 'yellow'));
        console.log((0, display_1.colorize)('  系统提示：', 'gray') +
            (cfg.system
                ? (0, display_1.colorize)(cfg.system.substring(0, 60) + (cfg.system.length > 60 ? '...' : ''), 'yellow')
                : (0, display_1.colorize)('（未设置）', 'gray')));
        console.log((0, display_1.colorize)('  历史消息：', 'gray') +
            (0, display_1.colorize)(`${history.length} 条`, history.length > 0 ? 'white' : 'gray'));
        console.log((0, display_1.colorize)('  请求超时：', 'gray') + (0, display_1.colorize)(`${cfg.timeoutMs / 1000}s`, 'gray'));
        console.log((0, display_1.colorize)('  对话轮次：', 'gray') + (0, display_1.colorize)(`${this.roundCount}`, 'white'));
        (0, display_1.printSeparator)('─', 'gray');
    }
    handleCommand(input) {
        const trimmed = input.trim();
        const parts = trimmed.split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1).join(' ');
        switch (cmd) {
            case '/help':
                this.showHelp();
                return true;
            case '/quit':
            case '/exit':
                this.quit();
                return true;
            case '/clear':
                this.client.clearHistory();
                this.roundCount = 0;
                console.log((0, display_1.colorize)('  ✓ 对话历史已清空', 'green'));
                return true;
            case '/reset':
                this.client.setSystem('');
                this.roundCount = 0;
                console.log((0, display_1.colorize)('  ✓ 对话历史和系统提示词已重置', 'green'));
                return true;
            case '/model': {
                if (!args) {
                    console.log((0, display_1.colorize)('  用法：/model <模型名称>', 'yellow'));
                    console.log((0, display_1.colorize)('  示例：/model gpt-4o', 'gray'));
                    console.log((0, display_1.colorize)('  示例：/model deepseek-chat', 'gray'));
                    return true;
                }
                this.client.setModel(args);
                this.roundCount = 0;
                console.log((0, display_1.colorize)('  ✓ 模型已切换为：', 'green') +
                    (0, display_1.colorize)(args, 'brightGreen', 'bold') +
                    (0, display_1.colorize)('（对话历史已清空）', 'gray'));
                return true;
            }
            case '/system': {
                if (!args) {
                    const currentSystem = this.client.getConfig().system;
                    if (currentSystem) {
                        console.log((0, display_1.colorize)('  当前系统提示词：', 'gray'));
                        console.log((0, display_1.colorize)('  ' + currentSystem, 'yellow'));
                    }
                    else {
                        console.log((0, display_1.colorize)('  系统提示词未设置', 'gray'));
                    }
                    console.log((0, display_1.colorize)('  用法：/system <提示词内容>', 'yellow'));
                    return true;
                }
                this.client.setSystem(args);
                this.roundCount = 0;
                console.log((0, display_1.colorize)('  ✓ 系统提示词已设置（对话历史已清空）', 'green'));
                return true;
            }
            case '/trace': {
                if (!args) {
                    const enabled = this.client.isTraceEnabled();
                    console.log((0, display_1.colorize)('  当前 Trace 状态：', 'gray') +
                        (0, display_1.colorize)(enabled ? 'ON' : 'OFF', enabled ? 'green' : 'yellow'));
                    console.log((0, display_1.colorize)('  用法：/trace on 或 /trace off', 'gray'));
                    return true;
                }
                const value = args.toLowerCase();
                if (value === 'on') {
                    this.client.setTraceEnabled(true);
                    console.log((0, display_1.colorize)('  ✓ Trace 日志已开启', 'green'));
                    return true;
                }
                if (value === 'off') {
                    this.client.setTraceEnabled(false);
                    console.log((0, display_1.colorize)('  ✓ Trace 日志已关闭', 'green'));
                    return true;
                }
                console.log((0, display_1.colorize)('  用法：/trace on 或 /trace off', 'yellow'));
                return true;
            }
            case '/history':
                this.showHistory();
                return true;
            case '/config':
                this.showConfig();
                return true;
            default:
                console.log((0, display_1.colorize)(`  未知命令: ${cmd}`, 'red') +
                    (0, display_1.colorize)('，输入 /help 查看可用命令', 'gray'));
                return true;
        }
    }
    startSpinner(msg) {
        const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        let i = 0;
        process.stdout.write('\n');
        this.spinnerInterval = setInterval(() => {
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
            process.stdout.write((0, display_1.colorize)(`  ${frames[i % frames.length]} `, 'cyan') + (0, display_1.colorize)(msg, 'gray'));
            i++;
        }, 80);
    }
    stopSpinner() {
        if (this.spinnerInterval) {
            clearInterval(this.spinnerInterval);
            this.spinnerInterval = null;
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
        }
    }
    printUserMessage(content) {
        console.log();
        console.log((0, display_1.colorize)('  ┌─ ', 'blue') +
            (0, display_1.colorize)('你', 'brightBlue', 'bold') +
            (0, display_1.colorize)(' ─────────────────────────────────────────────', 'blue'));
        const lines = content.split('\n');
        lines.forEach((line) => {
            console.log((0, display_1.colorize)('  │ ', 'blue') + line);
        });
        console.log((0, display_1.colorize)('  └────────────────────────────────────────────────', 'blue'));
    }
    printAssistantMessage(content, model) {
        const modelLabel = model ? (0, display_1.colorize)(` (${model})`, 'gray') : '';
        console.log((0, display_1.colorize)('  ┌─ ', 'magenta') +
            (0, display_1.colorize)('AI', 'brightMagenta', 'bold') +
            modelLabel +
            (0, display_1.colorize)(' ─────────────────────────────────────────────', 'magenta'));
        const formatted = (0, display_1.formatAssistantContent)(content);
        const lines = formatted.split('\n');
        lines.forEach((line) => {
            console.log((0, display_1.colorize)('  │ ', 'magenta') + line);
        });
        console.log((0, display_1.colorize)('  └────────────────────────────────────────────────', 'magenta'));
        console.log();
    }
    printToolCalls(toolCalls) {
        if (!toolCalls || toolCalls.length === 0)
            return;
        console.log((0, display_1.colorize)('  ┌─ ', 'yellow') +
            (0, display_1.colorize)('TOOL_CALLS', 'brightYellow', 'bold') +
            (0, display_1.colorize)(' ───────────────────────────────────────', 'yellow'));
        const text = JSON.stringify(toolCalls, null, 2);
        for (const line of text.split('\n')) {
            console.log((0, display_1.colorize)('  │ ', 'yellow') + (0, display_1.colorize)(line, 'brightYellow'));
        }
        console.log((0, display_1.colorize)('  └────────────────────────────────────────────────', 'yellow'));
        console.log();
    }
    printErrorMessage(message) {
        console.log();
        console.log((0, display_1.colorize)('  ✗ 错误：', 'red', 'bold') + (0, display_1.colorize)(message, 'red'));
        console.log();
    }
    async sendMessage(userInput) {
        this.isSending = true;
        this.printUserMessage(userInput);
        this.startSpinner('正在等待模型响应...');
        try {
            const response = await this.client.sendMessage(userInput);
            this.stopSpinner();
            this.roundCount++;
            console.log((0, display_1.colorize)(`  第 ${this.roundCount} 轮`, 'gray') +
                (0, display_1.colorize)(' ──────────────────────────────────────────────', 'gray'));
            this.printAssistantMessage(response.content, this.client.getConfig().model);
            this.printToolCalls(response.tool_calls);
        }
        catch (err) {
            this.stopSpinner();
            this.printErrorMessage(err.message);
        }
        finally {
            this.isSending = false;
        }
    }
    getPromptString() {
        const model = this.client.getConfig().model;
        return ((0, display_1.colorize)('  ', 'reset') +
            (0, display_1.colorize)('[', 'gray') +
            (0, display_1.colorize)(model, 'brightGreen') +
            (0, display_1.colorize)(']', 'gray') +
            (0, display_1.colorize)(' > ', 'brightWhite', 'bold'));
    }
    promptLoop() {
        if (!this.isRunning)
            return;
        this.rl.question(this.getPromptString(), async (input) => {
            const trimmed = input.trim();
            if (!trimmed) {
                this.promptLoop();
                return;
            }
            if (trimmed.startsWith('/')) {
                this.handleCommand(trimmed);
                if (this.isRunning) {
                    this.promptLoop();
                }
                return;
            }
            await this.sendMessage(trimmed);
            if (this.isRunning) {
                this.promptLoop();
            }
        });
    }
    quit() {
        this.isRunning = false;
        this.stopSpinner();
        console.log('\n');
        (0, display_1.printSeparator)();
        console.log((0, display_1.colorize)('  再见！感谢使用 WebClawProxy', 'cyan'));
        (0, display_1.printSeparator)();
        console.log();
        this.rl.close();
        process.exit(0);
    }
}
exports.ChatCLI = ChatCLI;
//# sourceMappingURL=ChatCLI.js.map