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
const display_1 = require("./utils/display");
const createNodeClientCore_1 = require("./core/createNodeClientCore");
/**
 * 交互式 CLI 界面
 */
class ChatCLI {
    constructor(config) {
        this.isRunning = false;
        this.isSending = false;
        this.spinnerInterval = null;
        this.roundCount = 0;
        this.core = (0, createNodeClientCore_1.createNodeClientCore)(config);
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
        const cfg = this.core.getTransport().getConfig();
        console.log((0, display_1.colorize)('  服务地址：', 'gray') + (0, display_1.colorize)(cfg.baseUrl, 'cyan') +
            (0, display_1.colorize)('    模型：', 'gray') + (0, display_1.colorize)(cfg.model, 'brightGreen'));
        if (cfg.system) {
            const preview = cfg.system.length > 60 ? cfg.system.substring(0, 57) + '...' : cfg.system;
            console.log((0, display_1.colorize)('  系统提示：', 'gray') + (0, display_1.colorize)(preview, 'yellow'));
        }
        console.log((0, display_1.colorize)('  会话ID：', 'gray') + (0, display_1.colorize)(cfg.sessionId, 'brightCyan') +
            (0, display_1.colorize)('    Trace：', 'gray') + (0, display_1.colorize)(cfg.traceEnabled ? 'ON' : 'OFF', cfg.traceEnabled ? 'green' : 'yellow') +
            (0, display_1.colorize)('    Stream：', 'gray') + (0, display_1.colorize)(cfg.stream ? 'ON' : 'OFF', cfg.stream ? 'green' : 'yellow'));
        (0, display_1.printSeparator)();
        console.log((0, display_1.colorize)('  输入消息开始对话，输入 /help 查看所有命令', 'gray'));
        (0, display_1.printSeparator)();
        process.stdout.write((0, display_1.colorize)('  正在连接服务...', 'gray'));
        const alive = await this.core.getTransport().healthCheck();
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
    showHistory() {
        const history = this.core.getState().history;
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
        const cfg = this.core.getTransport().getConfig();
        const history = this.core.getState().history;
        (0, display_1.printSeparator)('─', 'gray');
        console.log((0, display_1.colorize)('  当前配置：', 'cyan', 'bold'));
        console.log((0, display_1.colorize)('  服务地址：', 'gray') + (0, display_1.colorize)(cfg.baseUrl, 'cyan'));
        console.log((0, display_1.colorize)('  当前模型：', 'gray') + (0, display_1.colorize)(cfg.model, 'brightGreen'));
        console.log((0, display_1.colorize)('  会话ID：', 'gray') + (0, display_1.colorize)(cfg.sessionId, 'brightCyan'));
        console.log((0, display_1.colorize)('  Trace日志：', 'gray') +
            (0, display_1.colorize)(cfg.traceEnabled ? '开启' : '关闭', cfg.traceEnabled ? 'green' : 'yellow'));
        console.log((0, display_1.colorize)('  流式请求：', 'gray') +
            (0, display_1.colorize)(cfg.stream ? '开启' : '关闭', cfg.stream ? 'green' : 'yellow'));
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
    async handleCommand(input) {
        const result = await this.core.executeInput(input);
        return this.renderCoreResult(result);
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
            const result = await this.core.executeInput(userInput);
            this.stopSpinner();
            if (result.kind === 'chat') {
                this.roundCount++;
                console.log((0, display_1.colorize)(`  第 ${this.roundCount} 轮`, 'gray') +
                    (0, display_1.colorize)(' ──────────────────────────────────────────────', 'gray'));
                this.printAssistantMessage(result.response.content, result.model);
                this.printToolCalls(result.response.tool_calls);
            }
            else {
                this.renderCoreResult(result);
            }
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
        const model = this.core.getState().model;
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
                await this.handleCommand(trimmed);
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
    renderCoreResult(result) {
        if (result.kind !== 'command') {
            return false;
        }
        if (result.command === 'history') {
            this.showHistory();
        }
        else if (result.command === 'config') {
            this.showConfig();
        }
        else {
            const color = result.command === 'invalid' ? 'red' : 'green';
            result.lines.forEach((line) => {
                const prefix = result.command === 'invalid' ? '  ✗ ' : '  ✓ ';
                console.log((0, display_1.colorize)(`${prefix}${line}`, color));
            });
        }
        if (['clear', 'new', 'reset', 'model', 'provider'].includes(result.command)) {
            this.roundCount = 0;
        }
        if (result.shouldExit) {
            this.quit();
        }
        return true;
    }
}
exports.ChatCLI = ChatCLI;
//# sourceMappingURL=ChatCLI.js.map