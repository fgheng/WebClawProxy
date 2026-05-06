import * as readline from 'readline';
import { AgentClient, type AgentChatResponse, type AgentConfig } from './AgentClient';
import {
  colorize,
  printSeparator,
  printHeader,
  formatAssistantContent,
} from './utils/display';

/**
 * 交互式 CLI 界面（服务模式）
 *
 * TUI 不再直连 WebClawProxy 或 import WebClawClientCore，
 * 而是通过 Agent Service（HTTP + WebSocket）通信。
 */
export class ChatCLI {
  private client: AgentClient;
  private rl: readline.Interface;
  private isRunning = false;
  private isSending = false;
  private spinnerInterval: NodeJS.Timeout | null = null;
  private roundCount = 0;
  private currentModel: string;
  private currentMode: string;

  constructor(options: { agentUrl: string; model?: string; mode?: string }) {
    this.client = new AgentClient({ agentUrl: options.agentUrl });
    this.currentModel = options.model ?? 'gpt-4o';
    this.currentMode = options.mode ?? 'web';
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

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
    // 监听工具执行事件
    this.client.setEventCallback((event) => {
      if (event.type === 'tool_executing' && event.data.toolName) {
        const name = String(event.data.toolName);
        process.stdout.write(colorize(`  执行工具: ${name}...`, 'gray') + '\r');
      }
      if (event.type === 'tool_loop_end') {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
      }
    });
    this.client.connectWebSocket();
    this.promptLoop();
  }

  private async showWelcome(): Promise<void> {
    console.clear();
    printHeader('WebClawProxy TUI (服务模式)');

    console.log(
      colorize('  Agent Service：', 'gray') + colorize(this.client['baseUrl'], 'cyan') +
      colorize('    模型：', 'gray') + colorize(this.currentModel, 'brightGreen') +
      colorize('    Mode：', 'gray') + colorize(this.currentMode.toUpperCase(), 'brightYellow')
    );

    printSeparator();
    console.log(colorize('  输入消息开始对话，输入 /help 查看所有命令', 'gray'));
    console.log(colorize('  工具调用由 Agent Service 自动执行', 'gray'));
    printSeparator();

    process.stdout.write(colorize('  正在连接 Agent Service...', 'gray'));
    const alive = await this.client.healthCheck();
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);

    if (alive) {
      console.log(colorize('  ✓ Agent Service 已连接', 'green'));
    } else {
      console.log(colorize('  ✗ Agent Service 未响应（请先启动 agent service）', 'red'));
      console.log(colorize('  提示：可继续输入，连接成功后自动生效', 'gray'));
    }
    console.log();
  }

  private showConfig(): void {
    printSeparator('─', 'gray');
    console.log(colorize('  当前配置：', 'cyan', 'bold'));
    console.log(colorize('  Agent Service：', 'gray') + colorize(this.client['baseUrl'], 'cyan'));
    console.log(colorize('  当前模型：', 'gray') + colorize(this.currentModel, 'brightGreen'));
    console.log(colorize('  路由模式：', 'gray') + colorize(this.currentMode.toUpperCase(), 'brightYellow'));
    console.log(colorize('  会话ID：', 'gray') + colorize(this.client.getSessionId() ?? '(未创建)', 'brightCyan'));
    console.log(colorize('  对话轮次：', 'gray') + colorize(`${this.roundCount}`, 'white'));
    printSeparator('─', 'gray');
  }

  private startSpinner(msg: string): void {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    process.stdout.write('\n');
    this.spinnerInterval = setInterval(() => {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(colorize(`  ${frames[i % frames.length]} `, 'cyan') + colorize(msg, 'gray'));
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
    content.split('\n').forEach((line) => {
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
    formatAssistantContent(content).split('\n').forEach((line) => {
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
    for (const line of JSON.stringify(toolCalls, null, 2).split('\n')) {
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
    this.startSpinner('正在等待 Agent Service 响应...');

    try {
      const result = await this.client.chat(userInput, {
        model: this.currentModel,
        mode: this.currentMode,
      });

      this.stopSpinner();

      if (result.kind === 'chat') {
        this.roundCount++;
        console.log(colorize(`  第 ${this.roundCount} 轮`, 'gray') + colorize(' ──────────────────────────────────────────────', 'gray'));
        if (result.toolCalls && result.toolCalls.length > 0) {
          this.printToolCalls(result.toolCalls);
        }
        this.printAssistantMessage(result.content ?? '(空响应)', result.model);
      } else if (result.kind === 'command') {
        this.renderCommandResult(result);
      }
    } catch (err) {
      this.stopSpinner();
      this.printErrorMessage((err as Error).message);
    } finally {
      this.isSending = false;
    }
  }

  private renderCommandResult(result: AgentChatResponse): void {
    if (result.command === 'config') {
      this.showConfig();
    } else {
      const color = result.command === 'invalid' ? 'red' : 'green';
      (result.lines ?? []).forEach((line) => {
        const prefix = result.command === 'invalid' ? '  ✗ ' : '  ✓ ';
        console.log(colorize(`${prefix}${line}`, color as any));
      });
    }
  }

  private async handleCommand(input: string): Promise<void> {
    const parts = input.split(' ');
    const cmd = parts[0].toLowerCase();

    switch (cmd) {
      case '/help':
        console.log(colorize('  可用命令：', 'cyan'));
        console.log(colorize('  /help          显示帮助', 'gray'));
        console.log(colorize('  /model <名称>  切换模型', 'gray'));
        console.log(colorize('  /mode <web|forward> 切换模式', 'gray'));
        console.log(colorize('  /clear         清空对话', 'gray'));
        console.log(colorize('  /new           新建会话', 'gray'));
        console.log(colorize('  /config        查看配置', 'gray'));
        console.log(colorize('  /tools         查看可用工具', 'gray'));
        console.log(colorize('  /quit          退出', 'gray'));
        break;

      case '/model':
        if (parts[1]) {
          this.currentModel = parts[1];
          await this.client.updateConfig({ model: this.currentModel });
          console.log(colorize(`  ✓ 模型切换为 ${this.currentModel}`, 'green'));
          this.roundCount = 0;
        } else {
          console.log(colorize(`  当前模型：${this.currentModel}`, 'cyan'));
        }
        break;

      case '/mode':
        if (parts[1] === 'web' || parts[1] === 'forward') {
          this.currentMode = parts[1];
          await this.client.updateConfig({ mode: this.currentMode });
          console.log(colorize(`  ✓ 模式切换为 ${this.currentMode}`, 'green'));
        } else {
          console.log(colorize(`  当前模式：${this.currentMode}`, 'cyan'));
        }
        break;

      case '/clear':
        console.log(colorize('  ✓ 对话已清空（会话历史保留在 Agent Service）', 'green'));
        this.roundCount = 0;
        break;

      case '/new':
        try {
          const sessionId = await this.client.newSession({ model: this.currentModel, mode: this.currentMode });
          console.log(colorize(`  ✓ 新会话已创建: ${sessionId}`, 'green'));
          this.roundCount = 0;
        } catch (err) {
          this.printErrorMessage((err as Error).message);
        }
        break;

      case '/config':
        this.showConfig();
        break;

      case '/tools':
        try {
          const tools = await this.client.getTools();
          if (tools.length === 0) {
            console.log(colorize('  （无可用工具）', 'gray'));
          } else {
            console.log(colorize(`  可用工具（${tools.length} 个）：`, 'cyan'));
            tools.forEach((t) => {
              console.log(colorize(`    - ${t.name}`, 'brightGreen') + colorize(`: ${t.description.substring(0, 60)}`, 'gray'));
            });
          }
        } catch (err) {
          this.printErrorMessage((err as Error).message);
        }
        break;

      case '/quit':
        this.quit();
        return;

      default:
        console.log(colorize(`  ✗ 未知命令: ${cmd}`, 'red'));
        console.log(colorize('  输入 /help 查看可用命令', 'gray'));
        break;
    }
  }

  private getPromptString(): string {
    return (
      colorize('  ', 'reset') +
      colorize('[', 'gray') +
      colorize(this.currentModel, 'brightGreen') +
      colorize(']', 'gray') +
      colorize(' > ', 'brightWhite', 'bold')
    );
  }

  private promptLoop(): void {
    if (!this.isRunning) return;

    this.rl.question(this.getPromptString(), async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { this.promptLoop(); return; }

      if (trimmed.startsWith('/')) {
        await this.handleCommand(trimmed);
      } else {
        await this.sendMessage(trimmed);
      }

      if (this.isRunning) this.promptLoop();
    });
  }

  private quit(): void {
    this.isRunning = false;
    this.stopSpinner();
    this.client.disconnectWebSocket();
    console.log('\n');
    printSeparator();
    console.log(colorize('  再见！感谢使用 WebClawProxy', 'cyan'));
    printSeparator();
    console.log();
    this.rl.close();
    process.exit(0);
  }
}