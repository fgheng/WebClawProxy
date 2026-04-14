import { BrowserWindow } from 'electron';
import { IPty, spawn } from 'node-pty';

type TerminalStatus = 'stopped' | 'running';

export class ShellTerminalManager {
  private proc: IPty | null = null;
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
    this.proc.write(command);
  }

  async interrupt(): Promise<void> {
    if (!this.proc) return;
    this.proc.write('\u0003');
  }

  async resize(cols: number, rows: number): Promise<void> {
    if (!this.proc) return;
    this.proc.resize(Math.max(20, cols), Math.max(8, rows));
  }

  private startProcess(): void {
    this.proc = spawn(this.shellPath, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 32,
      cwd: this.cwd,
      env: {
        ...process.env,
        TERM: process.env.TERM || 'xterm-256color',
      },
    });

    this.setStatus('running');
    this.emitOutput(`\r\n[SYS ] Shell started: ${this.shellPath}\r\n`, 'system');
    this.emitOutput(`[SYS ] Working directory: ${this.cwd}\r\n`, 'system');

    this.proc.onData((data) => this.emitOutput(data, 'stdout'));
    this.proc.onExit(({ exitCode, signal }) => {
      this.emitOutput(`\r\n[SYS ] Shell exited (code=${exitCode ?? 'null'}, signal=${signal ?? 'null'})\r\n`, 'system');
      this.proc = null;
      this.setStatus('stopped');
    });
  }

  private emitOutput(message: string, stream: 'stdout' | 'system'): void {
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
