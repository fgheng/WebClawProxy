import { BrowserWindow } from 'electron';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';

type ServiceStatus = 'stopped' | 'starting' | 'running' | 'stopping';

export class ServiceManager {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private status: ServiceStatus = 'stopped';
  private stopTimer: NodeJS.Timeout | null = null;
  private startTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly projectRoot: string,
    private readonly browserBackend: 'playwright-launch' | 'electron-cdp',
    private readonly cdpUrl: string,
    private readonly window: BrowserWindow
  ) {}

  getStatus(): ServiceStatus {
    return this.status;
  }

  async start(): Promise<ServiceStatus> {
    if (this.proc || this.status === 'starting' || this.status === 'running') {
      return this.status;
    }

    this.setStatus('starting');

    const env = {
      ...process.env,
      WEBCLAW_BROWSER_BACKEND: this.browserBackend,
      WEBCLAW_CDP_URL: this.cdpUrl,
    };

    this.proc = spawn('npm', ['run', 'dev'], {
      cwd: this.projectRoot,
      env,
      stdio: 'pipe',
      detached: true,
    });

    this.startTimer = setTimeout(() => {
      if (!this.proc || this.status !== 'starting') return;
      this.emitError('WebClaw 服务启动超时');
      this.forceKillCurrentProcess();
    }, 20000);

    this.proc.stdout.on('data', (chunk) => this.handleProcessOutput(String(chunk), 'stdout'));
    this.proc.stderr.on('data', (chunk) => this.handleProcessOutput(String(chunk), 'stderr'));
    this.proc.on('error', (error) => {
      this.clearStartTimer();
      this.emitError(`WebClaw 服务启动失败: ${error.message}`);
      this.proc = null;
      this.setStatus('stopped');
    });
    this.proc.on('exit', (code, signal) => {
      const wasStarting = this.status === 'starting';
      if (this.stopTimer) {
        clearTimeout(this.stopTimer);
        this.stopTimer = null;
      }
      this.clearStartTimer();
      this.emitLog(`service exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
      this.proc = null;
      this.setStatus('stopped');
      if (wasStarting) {
        this.emitError(`WebClaw 服务启动失败（code=${code ?? 'null'}, signal=${signal ?? 'null'}）`);
      }
    });

    return this.status;
  }

  async stop(): Promise<ServiceStatus> {
    if (!this.proc || this.status === 'stopped') {
      return this.status;
    }
    this.setStatus('stopping');
    const pid = this.proc.pid;
    if (pid) {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        this.proc.kill('SIGTERM');
      }
      this.stopTimer = setTimeout(() => {
        if (!this.proc) return;
        this.emitLog('[Service] graceful stop timeout, sending SIGKILL', 'stderr');
        try {
          process.kill(-(this.proc.pid ?? 0), 'SIGKILL');
        } catch {
          this.proc?.kill('SIGKILL');
        }
      }, 5000);
    } else {
      this.proc.kill('SIGTERM');
    }
    return this.status;
  }

  async restart(): Promise<ServiceStatus> {
    await this.stop();
    return this.start();
  }

  private emitLog(message: string, stream: 'stdout' | 'stderr' = 'stdout'): void {
    this.window.webContents.send('service:log', {
      stream,
      message,
      timestamp: Date.now(),
    });
  }

  private emitError(message: string): void {
    this.window.webContents.send('service:error', {
      message,
      timestamp: Date.now(),
    });
  }

  private setStatus(status: ServiceStatus): void {
    this.status = status;
    this.window.webContents.send('service:status', {
      status,
      timestamp: Date.now(),
    });
  }

  private clearStartTimer(): void {
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
  }

  private handleProcessOutput(message: string, stream: 'stdout' | 'stderr'): void {
    this.emitLog(message, stream);
    if (this.status === 'starting' && /WebClawProxy 服务已启动|地址:\s*http:\/\/localhost:/u.test(message)) {
      this.clearStartTimer();
      this.setStatus('running');
    }
  }

  private forceKillCurrentProcess(): void {
    if (!this.proc) return;
    const pid = this.proc.pid;
    if (pid) {
      try {
        process.kill(-pid, 'SIGKILL');
        return;
      } catch {
        // fall through
      }
    }
    this.proc.kill('SIGKILL');
  }
}
