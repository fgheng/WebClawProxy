import { BrowserWindow } from 'electron';
import { IPty, spawn } from 'node-pty';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ChildProcessWithoutNullStreams, spawn as spawnChildProcess } from 'child_process';

export type TerminalStatus = 'stopped' | 'running';

export type TerminalInfo = {
  terminalId: string;
  status: TerminalStatus;
  backend: 'pty' | 'raw' | null;
  shell: string;
  cwd: string;
  pid: number | null;
};

type TerminalSession = {
  id: string;
  proc: IPty | null;
  rawProc: ChildProcessWithoutNullStreams | null;
  backend: 'pty' | 'raw' | null;
  status: TerminalStatus;
  shell: string;
  cwd: string;
  lastStartFailureAt: number;
  pid: number | null;
};

export class ShellTerminalManager {
  private seq = 0;
  private sessions = new Map<string, TerminalSession>();

  constructor(
    private readonly cwd: string,
    private readonly window: BrowserWindow
  ) {
    this.ensureNodePtyHelperExecutable();
  }

  list(): TerminalInfo[] {
    return Array.from(this.sessions.values()).map((s) => ({
      terminalId: s.id,
      status: s.status,
      backend: s.backend,
      shell: s.shell,
      cwd: s.cwd,
      pid: s.pid,
    }));
  }

  async ensureDefaultStarted(): Promise<{ terminals: TerminalInfo[]; activeTerminalId: string | null }> {
    if (this.sessions.size === 0) {
      await this.create();
    }
    return { terminals: this.list(), activeTerminalId: this.getFirstTerminalId() };
  }

  async create(options?: { shell?: string; cwd?: string }): Promise<TerminalInfo> {
    const id = `term-${String(++this.seq).padStart(2, '0')}`;
    const cwd = this.resolveCwd(options?.cwd ?? this.cwd);
    const shell = this.pickShellCandidates(options?.shell)[0] ?? this.defaultShell();
    const sess: TerminalSession = {
      id,
      proc: null,
      rawProc: null,
      backend: null,
      status: 'stopped',
      shell,
      cwd,
      lastStartFailureAt: 0,
      pid: null,
    };
    this.sessions.set(id, sess);
    await this.ensureStarted(id);
    return { terminalId: id, status: sess.status, backend: sess.backend, shell: sess.shell, cwd: sess.cwd, pid: sess.pid };
  }

  async close(terminalId: string): Promise<{ closed: boolean }> {
    const sess = this.sessions.get(terminalId);
    if (!sess) return { closed: false };
    this.sessions.delete(terminalId);

    if (sess.proc) {
      try {
        sess.proc.kill();
      } catch {
      }
    }
    if (sess.rawProc) {
      try {
        sess.rawProc.kill('SIGTERM');
      } catch {
      }
    }
    sess.proc = null;
    sess.rawProc = null;
    sess.backend = null;
    sess.pid = null;
    sess.status = 'stopped';
    return { closed: true };
  }

  async ensureStarted(terminalId: string): Promise<TerminalInfo | null> {
    const sess = this.sessions.get(terminalId);
    if (!sess) return null;

    const running =
      (sess.backend === 'pty' && Boolean(sess.proc)) ||
      (sess.backend === 'raw' && Boolean(sess.rawProc));

    if (!running && Date.now() - sess.lastStartFailureAt > 1500) {
      try {
        this.startProcess(sess);
      } catch (error) {
        sess.lastStartFailureAt = Date.now();
        sess.proc = null;
        sess.rawProc = null;
        sess.backend = null;
        sess.pid = null;
        sess.status = 'stopped';
        this.emitStatus(sess);
        this.emitOutput(
          terminalId,
          `\r\n[SYS ] Failed to start shell ${sess.shell}: ${error instanceof Error ? error.message : String(error)}\r\n`,
          'system'
        );
      }
    }

    return { terminalId: sess.id, status: sess.status, backend: sess.backend, shell: sess.shell, cwd: sess.cwd, pid: sess.pid };
  }

  async write(terminalId: string, command: string): Promise<void> {
    await this.ensureStarted(terminalId);
    const sess = this.sessions.get(terminalId);
    if (!sess) return;
    if (sess.backend === 'pty' && sess.proc) {
      sess.proc.write(command);
      return;
    }
    if (sess.backend === 'raw' && sess.rawProc?.stdin) {
      sess.rawProc.stdin.write(command);
    }
  }

  async interrupt(terminalId: string): Promise<void> {
    const sess = this.sessions.get(terminalId);
    if (!sess) return;
    if (sess.backend === 'pty' && sess.proc) {
      sess.proc.write('\u0003');
      return;
    }
    if (sess.backend === 'raw' && sess.rawProc) {
      try {
        sess.rawProc.kill('SIGINT');
      } catch {
      }
    }
  }

  async resize(terminalId: string, cols: number, rows: number): Promise<void> {
    const sess = this.sessions.get(terminalId);
    if (!sess) return;
    if (sess.backend === 'pty' && sess.proc) {
      sess.proc.resize(Math.max(20, cols), Math.max(8, rows));
    }
  }

  private getFirstTerminalId(): string | null {
    const first = this.sessions.values().next().value as TerminalSession | undefined;
    return first?.id ?? null;
  }

  private startProcess(sess: TerminalSession): void {
    this.ensureNodePtyHelperExecutable();
    const candidates = this.pickShellCandidates(sess.shell);
    let lastError: unknown = null;

    for (const candidate of candidates) {
      try {
        sess.proc = spawn(candidate, ['-l'], {
          name: 'xterm-256color',
          cols: 120,
          rows: 32,
          cwd: sess.cwd,
          env: {
            ...process.env,
            TERM: process.env.TERM || 'xterm-256color',
            PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
          },
        });

        sess.rawProc = null;
        sess.backend = 'pty';
        sess.shell = candidate;
        sess.pid = sess.proc.pid ?? null;
        sess.status = 'running';
        this.emitStatus(sess);
        this.emitOutput(sess.id, `\r\n[SYS ] Shell started: ${sess.shell}\r\n`, 'system');
        this.emitOutput(sess.id, `[SYS ] Working directory: ${sess.cwd}\r\n`, 'system');

        sess.proc.onData((data) => this.emitOutput(sess.id, data, 'stdout'));
        sess.proc.onExit(({ exitCode, signal }) => {
          if (!this.sessions.has(sess.id)) return;
          this.emitOutput(sess.id, `\r\n[SYS ] Shell exited (code=${exitCode ?? 'null'}, signal=${signal ?? 'null'})\r\n`, 'system');
          sess.proc = null;
          sess.rawProc = null;
          sess.backend = null;
          sess.pid = null;
          sess.status = 'stopped';
          this.emitStatus(sess);
        });
        return;
      } catch (error) {
        lastError = error;
      }
    }

    this.emitOutput(sess.id, `\r\n[SYS ] PTY backend unavailable, fallback to raw shell mode.\r\n`, 'system');
    this.startRawProcess(sess);
    if (sess.status === 'running') {
      return;
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'posix_spawnp failed'));
  }

  private startRawProcess(sess: TerminalSession): void {
    const candidates = this.pickShellCandidates(sess.shell);
    let lastError: unknown = null;

    for (const candidate of candidates) {
      try {
        const env = this.getSafeEnv();
        const child = spawnChildProcess(candidate, ['-l'], {
          cwd: sess.cwd,
          env,
          stdio: 'pipe',
        });

        sess.proc = null;
        sess.rawProc = child;
        sess.backend = 'raw';
        sess.shell = candidate;
        sess.pid = child.pid ?? null;
        sess.status = 'running';
        this.emitStatus(sess);
        this.emitOutput(sess.id, `\r\n[SYS ] Shell started (raw): ${sess.shell}\r\n`, 'system');
        this.emitOutput(sess.id, `[SYS ] Working directory: ${sess.cwd}\r\n`, 'system');

        child.stdout.on('data', (buf) => this.emitOutput(sess.id, this.normalizeOutputText(String(buf)), 'stdout'));
        child.stderr.on('data', (buf) => this.emitOutput(sess.id, this.normalizeOutputText(String(buf)), 'stdout'));
        child.on('exit', (exitCode, signal) => {
          if (!this.sessions.has(sess.id)) return;
          this.emitOutput(sess.id, `\r\n[SYS ] Shell exited (code=${exitCode ?? 'null'}, signal=${signal ?? 'null'})\r\n`, 'system');
          sess.proc = null;
          sess.rawProc = null;
          sess.backend = null;
          sess.pid = null;
          sess.status = 'stopped';
          this.emitStatus(sess);
        });
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'spawn failed'));
  }

  private resolveCwd(cwd: string): string {
    const raw = (cwd ?? '').trim();
    const resolved = raw.length > 0 ? raw : this.cwd;
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved;
    } catch {
    }
    return os.homedir();
  }

  private defaultShell(): string {
    return this.pickShellCandidates(undefined)[0] ?? '/bin/zsh';
  }

  private ensureNodePtyHelperExecutable(): void {
    try {
      const pkgPath = require.resolve('node-pty/package.json');
      const pkgDir = path.dirname(pkgPath);
      const helperCandidates = [
        path.join(pkgDir, 'build', 'Release', 'spawn-helper'),
        path.join(pkgDir, 'prebuilds', 'darwin-arm64', 'spawn-helper'),
        path.join(pkgDir, 'prebuilds', 'darwin-x64', 'spawn-helper'),
      ];

      for (const helperPath of helperCandidates) {
        if (!fs.existsSync(helperPath)) continue;
        try {
          fs.accessSync(helperPath, fs.constants.X_OK);
        } catch {
          fs.chmodSync(helperPath, 0o755);
        }
      }
    } catch {
    }
  }

  private normalizeOutputText(text: string): string {
    return String(text ?? '').replace(/\r?\n/g, '\r\n');
  }

  private getSafeEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') env[key] = value;
    }
    if (!env.TERM) env.TERM = 'xterm-256color';
    if (!env.PATH) env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
    return env;
  }

  private pickShellCandidates(preferred?: string): string[] {
    const candidates = [
      preferred,
      process.env.SHELL,
      '/bin/zsh',
      '/bin/bash',
      '/bin/sh',
    ]
      .map((item) => (item ?? '').trim())
      .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index);

    const ok: string[] = [];
    for (const candidate of candidates) {
      try {
        fs.accessSync(candidate, fs.constants.F_OK | fs.constants.X_OK);
        ok.push(candidate);
      } catch {
      }
    }
    return ok.length > 0 ? ok : ['/bin/zsh', '/bin/bash', '/bin/sh'];
  }

  private emitOutput(terminalId: string, message: string, stream: 'stdout' | 'system'): void {
    this.window.webContents.send('terminal:output', {
      terminalId,
      stream,
      message,
      timestamp: Date.now(),
    });
  }

  private emitStatus(sess: TerminalSession): void {
    this.window.webContents.send('terminal:status', {
      terminalId: sess.id,
      status: sess.status,
      backend: sess.backend,
      timestamp: Date.now(),
      shell: sess.shell,
      cwd: sess.cwd,
      pid: sess.pid,
    });
  }
}
