import * as readline from 'readline';
import { WebClawClient } from './WebClawClient';
import { ClientConfig, ChatMessage } from './types';
import {
  colorize,
  printSeparator,
  printHeader,
  formatAssistantContent,
} from './utils/display';

/**
 * 交互式 CLI 界面
 */
export class ChatCLI {
  private client: WebClawClient;
  private rl: readline.Interface;
  private isRunning = false;
  private isSending = false;
  private spinnerInterval: NodeJS.Timeout | null = null;
  private roundCount = 0;

  constructor(config: ClientConfig) {
    this.client = new WebClawClient(config);
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

    const cfg = this.client.getConfig();
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
      colorize('    Trace：', 'gray') + colorize(cfg.traceEnabled ? 'ON' : 'OFF', cfg.traceEnabled ? 'green' : 'yellow')
    );

    printSeparator();
    console.log(colorize('  输入消息开始对话，输入 /help 查看所有命令', 'gray'));
    printSeparator();

    process.stdout.write(colorize('  正在连接服务...', 'gray'));
    const alive = await this.client.healthCheck();
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

  private showHelp(): void {
    printSeparator('─', 'gray');
    console.log(colorize('  可用命令：', 'cyan', 'bold'));
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
      console.log('  ' + colorize(cmd.padEnd(22), 'brightYellow') + colorize(desc, 'gray'));
    });
    printSeparator('─', 'gray');
  }

  private showHistory(): void {
    const history = this.client.getHistory();
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
    const cfg = this.client.getConfig();
    const history = this.client.getHistory();

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
      colorize('  系统提示：', 'gray') +
      (cfg.system
        ? colorize(cfg.system.substring(0, 60) + (cfg.system.length > 60 ? '...' : ''), 'yellow')
        : colorize('（未设置）', 'gray'))
    );
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

  private handleCommand(input: string): boolean {
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
        console.log(colorize('  ✓ 对话历史已清空', 'green'));
        return true;

      case '/reset':
        this.client.setSystem('');
        this.roundCount = 0;
        console.log(colorize('  ✓ 对话历史和系统提示词已重置', 'green'));
        return true;

      case '/model': {
        if (!args) {
          console.log(colorize('  用法：/model <模型名称>', 'yellow'));
          console.log(colorize('  示例：/model gpt-4o', 'gray'));
          console.log(colorize('  示例：/model deepseek-chat', 'gray'));
          return true;
        }
        this.client.setModel(args);
        this.roundCount = 0;
        console.log(
          colorize('  ✓ 模型已切换为：', 'green') +
          colorize(args, 'brightGreen', 'bold') +
          colorize('（对话历史已清空）', 'gray')
        );
        return true;
      }

      case '/system': {
        if (!args) {
          const currentSystem = this.client.getConfig().system;
          if (currentSystem) {
            console.log(colorize('  当前系统提示词：', 'gray'));
            console.log(colorize('  ' + currentSystem, 'yellow'));
          } else {
            console.log(colorize('  系统提示词未设置', 'gray'));
          }
          console.log(colorize('  用法：/system <提示词内容>', 'yellow'));
          return true;
        }
        this.client.setSystem(args);
        this.roundCount = 0;
        console.log(colorize('  ✓ 系统提示词已设置（对话历史已清空）', 'green'));
        return true;
      }

      case '/trace': {
        if (!args) {
          const enabled = this.client.isTraceEnabled();
          console.log(
            colorize('  当前 Trace 状态：', 'gray') +
            colorize(enabled ? 'ON' : 'OFF', enabled ? 'green' : 'yellow')
          );
          console.log(colorize('  用法：/trace on 或 /trace off', 'gray'));
          return true;
        }

        const value = args.toLowerCase();
        if (value === 'on') {
          this.client.setTraceEnabled(true);
          console.log(colorize('  ✓ Trace 日志已开启', 'green'));
          return true;
        }
        if (value === 'off') {
          this.client.setTraceEnabled(false);
          console.log(colorize('  ✓ Trace 日志已关闭', 'green'));
          return true;
        }

        console.log(colorize('  用法：/trace on 或 /trace off', 'yellow'));
        return true;
      }

      case '/history':
        this.showHistory();
        return true;

      case '/config':
        this.showConfig();
        return true;

      default:
        console.log(
          colorize(`  未知命令: ${cmd}`, 'red') +
          colorize('，输入 /help 查看可用命令', 'gray')
        );
        return true;
    }
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
      const response = await this.client.sendMessage(userInput);
      this.stopSpinner();
      this.roundCount++;

      console.log(
        colorize(`  第 ${this.roundCount} 轮`, 'gray') +
        colorize(' ──────────────────────────────────────────────', 'gray')
      );

      this.printAssistantMessage(response, this.client.getConfig().model);
    } catch (err) {
      this.stopSpinner();
      this.printErrorMessage((err as Error).message);
    } finally {
      this.isSending = false;
    }
  }

  private getPromptString(): string {
    const model = this.client.getConfig().model;
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
}
