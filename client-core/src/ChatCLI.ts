import * as readline from 'readline';
import { ClientConfig, ChatMessage } from './types';
import {
  colorize,
  printSeparator,
  printHeader,
  formatAssistantContent,
} from './utils/display';
import { WebClawClientCore } from './core/WebClawClientCore';
import { ClientCoreResult } from './core/types';
import { createNodeClientCore } from './core/createNodeClientCore';

/**
 * 交互式 CLI 界面
 */
export class ChatCLI {
  private core: WebClawClientCore;
  private rl: readline.Interface;
  private isRunning = false;
  private isSending = false;
  private spinnerInterval: NodeJS.Timeout | null = null;
  private roundCount = 0;

  constructor(config: ClientConfig) {
    this.core = createNodeClientCore(config);
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    // 监听 Ctrl+C
    this.rl.on('SIGINT', () => {
      if (this.isSending) {
        console.log('\n' + colorize('⚠ 消息发送中，请等待响应完成...', 'yellow'));
      } else {
        this.quit();
      }
    });
  }

  async start(): Promise<void> {
    this.isRunning = true;
    await this.showWelcome();
    this.promptLoop();
  }

  private async showWelcome(): Promise<void> {
    console.clear();
    printHeader('WebClawProxy 客户端');

    const cfg = this.core.getTransport().getConfig();
    console.log(
      colorize('  服务地址：', 'gray') + colorize(cfg.baseUrl, 'cyan') +
      colorize('    模型：', 'gray') + colorize(cfg.model, 'brightGreen')
    );
    if (cfg.system) {
      const preview = cfg.system.length > 60 ? cfg.system.substring(0, 57) + '...' : cfg.system;
      console.log(colorize('  系统提示：', 'gray') + colorize(preview, 'yellow'));
    }
    console.log(
      colorize('  会话ID：', 'gray') + colorize(cfg.sessionId, 'brightCyan') +
      colorize('    Mode：', 'gray') + colorize((this.core.getState().mode ?? 'web').toUpperCase(), 'brightYellow') +
      colorize('    Trace：', 'gray') + colorize(cfg.traceEnabled ? 'ON' : 'OFF', cfg.traceEnabled ? 'green' : 'yellow') +
      colorize('    Stream：', 'gray') + colorize(cfg.stream ? 'ON' : 'OFF', cfg.stream ? 'green' : 'yellow')
    );

    printSeparator();
    console.log(colorize('  输入消息开始对话，输入 /help 查看所有命令', 'gray'));
    printSeparator();

    process.stdout.write(colorize('  正在连接服务...', 'gray'));
    const alive = await this.core.getTransport().healthCheck();
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);

    if (alive) {
      console.log(colorize('  ✓ 服务已连接', 'green'));
    } else {
      console.log(colorize('  ✗ 服务未响应（请先运行 npm run dev 启动服务）', 'red'));
      console.log(colorize('  提示：可继续输入，连接成功后自动生效', 'gray'));
    }
    console.log();
  }

  private showHistory(): void {
    const history = this.core.getState().history;
    if (history.length === 0) {
      console.log(colorize('  （对话历史为空）', 'gray'));
      return;
    }

    printSeparator('─', 'gray');
    console.log(colorize(`  当前对话历史（共 ${history.length} 条）：`, 'cyan', 'bold'));
    printSeparator('─', 'gray');

    history.forEach((msg: ChatMessage, i: number) => {
      const roleLabel = msg.role === 'user' ? '你' : 'AI';
      const roleColor = msg.role === 'user' ? 'brightBlue' : 'brightMagenta';
      const preview =
        typeof msg.content === 'string' && msg.content.length > 100
          ? msg.content.substring(0, 97) + '...'
          : msg.content;
      console.log(
        colorize(`  [${i + 1}] ${roleLabel}: `, roleColor, 'bold') +
        colorize(String(preview), 'gray')
      );
    });
    printSeparator('─', 'gray');
  }

  private showConfig(): void {
    const cfg = this.core.getTransport().getConfig();
    const history = this.core.getState().history;

    printSeparator('─', 'gray');
    console.log(colorize('  当前配置：', 'cyan', 'bold'));
    console.log(colorize('  服务地址：', 'gray') + colorize(cfg.baseUrl, 'cyan'));
    console.log(colorize('  当前模型：', 'gray') + colorize(cfg.model, 'brightGreen'));
    console.log(colorize('  会话ID：', 'gray') + colorize(cfg.sessionId, 'brightCyan'));
    console.log(
      colorize('  Trace日志：', 'gray') +
      colorize(cfg.traceEnabled ? '开启' : '关闭', cfg.traceEnabled ? 'green' : 'yellow')
    );
    console.log(
      colorize('  流式请求：', 'gray') +
      colorize(cfg.stream ? '开启' : '关闭', cfg.stream ? 'green' : 'yellow')
    );
    console.log(
      colorize('  系统提示：', 'gray') +
      (cfg.system
        ? colorize(cfg.system.substring(0, 60) + (cfg.system.length > 60 ? '...' : ''), 'yellow')
        : colorize('（未设置）', 'gray'))
    );
    console.log(colorize('  路由模式：', 'gray') + colorize(this.core.getState().mode.toUpperCase(), 'brightYellow'));
    console.log(
      colorize('  历史消息：', 'gray') +
      colorize(`${history.length} 条`, history.length > 0 ? 'white' : 'gray')
    );
    console.log(
      colorize('  请求超时：', 'gray') + colorize(`${cfg.timeoutMs / 1000}s`, 'gray')
    );
    console.log(colorize('  对话轮次：', 'gray') + colorize(`${this.roundCount}`, 'white'));
    printSeparator('─', 'gray');
  }

  private async handleCommand(input: string): Promise<boolean> {
    const result = await this.core.executeInput(input);
    return this.renderCoreResult(result);
  }

  private startSpinner(msg: string): void {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    process.stdout.write('\n');
    this.spinnerInterval = setInterval(() => {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(
        colorize(`  ${frames[i % frames.length]} `, 'cyan') + colorize(msg, 'gray')
      );
      i++;
    }, 80);
  }

  private stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
    }
  }

  private printUserMessage(content: string): void {
    console.log();
    console.log(
      colorize('  ┌─ ', 'blue') +
      colorize('你', 'brightBlue', 'bold') +
      colorize(' ─────────────────────────────────────────────', 'blue')
    );

    const lines = content.split('\n');
    lines.forEach((line) => {
      console.log(colorize('  │ ', 'blue') + line);
    });
    console.log(colorize('  └────────────────────────────────────────────────', 'blue'));
  }

  private printAssistantMessage(content: string, model?: string): void {
    const modelLabel = model ? colorize(` (${model})`, 'gray') : '';
    console.log(
      colorize('  ┌─ ', 'magenta') +
      colorize('AI', 'brightMagenta', 'bold') +
      modelLabel +
      colorize(' ─────────────────────────────────────────────', 'magenta')
    );

    const formatted = formatAssistantContent(content);
    const lines = formatted.split('\n');
    lines.forEach((line) => {
      console.log(colorize('  │ ', 'magenta') + line);
    });
    console.log(colorize('  └────────────────────────────────────────────────', 'magenta'));
    console.log();
  }

  private printToolCalls(toolCalls: unknown[]): void {
    if (!toolCalls || toolCalls.length === 0) return;

    console.log(
      colorize('  ┌─ ', 'yellow') +
      colorize('TOOL_CALLS', 'brightYellow', 'bold') +
      colorize(' ───────────────────────────────────────', 'yellow')
    );

    const text = JSON.stringify(toolCalls, null, 2);
    for (const line of text.split('\n')) {
      console.log(colorize('  │ ', 'yellow') + colorize(line, 'brightYellow'));
    }

    console.log(colorize('  └────────────────────────────────────────────────', 'yellow'));
    console.log();
  }

  private printErrorMessage(message: string): void {
    console.log();
    console.log(colorize('  ✗ 错误：', 'red', 'bold') + colorize(message, 'red'));
    console.log();
  }

  private async sendMessage(userInput: string): Promise<void> {
    this.isSending = true;
    this.printUserMessage(userInput);

    this.startSpinner('正在等待模型响应...');

    try {
      const result = await this.core.executeInput(userInput);
      this.stopSpinner();
      if (result.kind === 'chat') {
        this.roundCount++;
        console.log(
          colorize(`  第 ${this.roundCount} 轮`, 'gray') +
          colorize(' ──────────────────────────────────────────────', 'gray')
        );
        this.printAssistantMessage(result.response.content, result.model);
        this.printToolCalls(result.response.tool_calls);
      } else {
        this.renderCoreResult(result);
      }
    } catch (err) {
      this.stopSpinner();
      this.printErrorMessage((err as Error).message);
    } finally {
      this.isSending = false;
    }
  }

  private getPromptString(): string {
    const model = this.core.getState().model;
    return (
      colorize('  ', 'reset') +
      colorize('[', 'gray') +
      colorize(model, 'brightGreen') +
      colorize(']', 'gray') +
      colorize(' > ', 'brightWhite', 'bold')
    );
  }

  private promptLoop(): void {
    if (!this.isRunning) return;

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

  private quit(): void {
    this.isRunning = false;
    this.stopSpinner();
    console.log('\n');
    printSeparator();
    console.log(colorize('  再见！感谢使用 WebClawProxy', 'cyan'));
    printSeparator();
    console.log();
    this.rl.close();
    process.exit(0);
  }

  private renderCoreResult(result: ClientCoreResult): boolean {
    if (result.kind !== 'command') {
      return false;
    }

    if (result.command === 'history') {
      this.showHistory();
    } else if (result.command === 'config') {
      this.showConfig();
    } else {
      const color = result.command === 'invalid' ? 'red' : 'green';
      result.lines.forEach((line) => {
        const prefix = result.command === 'invalid' ? '  ✗ ' : '  ✓ ';
        console.log(colorize(`${prefix}${line}`, color as any));
      });
    }

    if (['clear', 'new', 'reset', 'model', 'provider', 'mode', 'session'].includes(result.command)) {
      this.roundCount = 0;
    }

    if (result.shouldExit) {
      this.quit();
    }

    return true;
  }
}
