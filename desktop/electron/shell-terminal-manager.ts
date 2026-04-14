import { BrowserWindow } from 'electron';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';

type TerminalStatus = 'stopped' | 'running';
type TerminalStream = 'stdout' | 'stderr' | 'system';

export class ShellTerminalManager {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private status: TerminalStatus = 'stopped';
  private readonly shellPath: string;

  constructor(
    private readonly cwd: string,
    private readonly window: BrowserWindow
  ) {
    this.shellPath = process.env.SHELL || '/bin/zsh';
  }

  async ensureStarted(): Promise<{
    status: TerminalStatus;
    shell: string;
    cwd: string;
    pid: number | null;
  }> {
    if (!this.proc) {
      this.startProcess();
    }

    return {
      status: this.status,
      shell: this.shellPath,
      cwd: this.cwd,
      pid: this.proc?.pid ?? null,
    };
  }

  async write(command: string): Promise<void> {
    await this.ensureStarted();
    if (!this.proc) {
      throw new Error('终端进程未启动');
    }
    this.proc.stdin.write(`${command}\n`);
  }

  async interrupt(): Promise<void> {
    if (!this.proc) return;
    this.proc.kill('SIGINT');
  }

  private startProcess(): void {
    this.proc = spawn(this.shellPath, [], {
      cwd: this.cwd,
      env: {
        ...process.env,
        TERM: process.env.TERM || 'xterm-256color',
      },
      stdio: 'pipe',
    });

    this.setStatus('running');
    this.emitOutput(`Shell started: ${this.shellPath}`, 'system');
    this.emitOutput(`Working directory: ${this.cwd}`, 'system');

    this.proc.stdout.on('data', (chunk) => this.emitOutput(String(chunk), 'stdout'));
    this.proc.stderr.on('data', (chunk) => this.emitOutput(String(chunk), 'stderr'));
    this.proc.on('exit', (code, signal) => {
      this.emitOutput(`Shell exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`, 'system');
      this.proc = null;
      this.setStatus('stopped');
    });
    this.proc.on('error', (error) => {
      this.emitOutput(`Shell error: ${error.message}`, 'stderr');
      this.proc = null;
      this.setStatus('stopped');
    });
  }

  private emitOutput(message: string, stream: TerminalStream): void {
    this.window.webContents.send('terminal:output', {
      stream,
      message,
      timestamp: Date.now(),
    });
  }

  private setStatus(status: TerminalStatus): void {
    this.status = status;
    this.window.webContents.send('terminal:status', {
      status,
      timestamp: Date.now(),
      shell: this.shellPath,
      cwd: this.cwd,
      pid: this.proc?.pid ?? null,
    });
  }
}
