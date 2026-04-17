import { BrowserWindow } from 'electron';
import { IPty, spawn } from 'node-pty';
import * as fs from 'fs';

type TerminalStatus = 'stopped' | 'running';

export class ShellTerminalManager {
  private proc: IPty | null = null;
  private status: TerminalStatus = 'stopped';
  private readonly shellPath: string;
  private lastStartFailureAt = 0;

  constructor(
    private readonly cwd: string,
    private readonly window: BrowserWindow
  ) {
    this.shellPath = this.resolveShellPath();
  }

  async ensureStarted(): Promise<{
    status: TerminalStatus;
    shell: string;
    cwd: string;
    pid: number | null;
  }> {
    if (!this.proc && Date.now() - this.lastStartFailureAt > 1500) {
      try {
        this.startProcess();
      } catch (error) {
        this.lastStartFailureAt = Date.now();
        this.proc = null;
        this.setStatus('stopped');
        this.emitOutput(
          `\r\n[SYS ] Failed to start shell ${this.shellPath}: ${error instanceof Error ? error.message : String(error)}\r\n`,
          'system'
        );
      }
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
      return;
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

  private resolveShellPath(): string {
    // 优先使用系统默认 shell
    const candidates = [
      '/bin/sh',  // ✅ POSIX 标准，最可靠
      '/bin/bash',
      '/bin/zsh',
      process.env.SHELL,
    ]
      .map((item) => (item ?? '').trim())
      .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index);

    for (const candidate of candidates) {
      try {
        // 检查文件是否存在且可执行
        fs.accessSync(candidate, fs.constants.F_OK | fs.constants.X_OK);
        console.log(`[ShellTerminalManager] Using shell: ${candidate}`);
        return candidate;
      } catch {
        // try next candidate
      }
    }

    console.warn('[ShellTerminalManager] No valid shell found, falling back to /bin/sh');
    return '/bin/sh';
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
