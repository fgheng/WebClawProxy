import { BrowserWindow } from 'electron';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';

type ServiceStatus = 'stopped' | 'starting' | 'running' | 'stopping';

export class ServiceManager {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private status: ServiceStatus = 'stopped';

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
    if (this.proc || this.status === 'starting') {
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
    });

    this.proc.stdout.on('data', (chunk) => this.emitLog(String(chunk)));
    this.proc.stderr.on('data', (chunk) => this.emitLog(String(chunk), 'stderr'));
    this.proc.on('spawn', () => this.setStatus('running'));
    this.proc.on('exit', (code, signal) => {
      this.emitLog(`service exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
      this.proc = null;
      this.setStatus('stopped');
    });

    return this.status;
  }

  async stop(): Promise<ServiceStatus> {
    if (!this.proc || this.status === 'stopped') {
      return this.status;
    }
    this.setStatus('stopping');
    this.proc.kill('SIGTERM');
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

  private setStatus(status: ServiceStatus): void {
    this.status = status;
    this.window.webContents.send('service:status', {
      status,
      timestamp: Date.now(),
    });
  }
}
