"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceManager = void 0;
const child_process_1 = require("child_process");
class ServiceManager {
    constructor(projectRoot, browserBackend, cdpUrl, window) {
        this.projectRoot = projectRoot;
        this.browserBackend = browserBackend;
        this.cdpUrl = cdpUrl;
        this.window = window;
        this.proc = null;
        this.status = 'stopped';
        this.stopTimer = null;
        this.startTimer = null;
    }
    getStatus() {
        return this.status;
    }
    async start() {
        if (this.proc || this.status === 'starting' || this.status === 'running') {
            return this.status;
        }
        this.setStatus('starting');
        const env = {
            ...process.env,
            WEBCLAW_BROWSER_BACKEND: this.browserBackend,
            WEBCLAW_CDP_URL: this.cdpUrl,
        };
        this.proc = (0, child_process_1.spawn)('npm', ['run', 'dev'], {
            cwd: this.projectRoot,
            env,
            stdio: 'pipe',
            detached: true,
        });
        this.startTimer = setTimeout(() => {
            if (!this.proc || this.status !== 'starting')
                return;
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
    async stop() {
        if (!this.proc || this.status === 'stopped') {
            return this.status;
        }
        this.setStatus('stopping');
        const pid = this.proc.pid;
        if (pid) {
            try {
                process.kill(-pid, 'SIGTERM');
            }
            catch {
                this.proc.kill('SIGTERM');
            }
            this.stopTimer = setTimeout(() => {
                if (!this.proc)
                    return;
                this.emitLog('[Service] graceful stop timeout, sending SIGKILL', 'stderr');
                try {
                    process.kill(-(this.proc.pid ?? 0), 'SIGKILL');
                }
                catch {
                    this.proc?.kill('SIGKILL');
                }
            }, 5000);
        }
        else {
            this.proc.kill('SIGTERM');
        }
        return this.status;
    }
    async restart() {
        await this.stop();
        return this.start();
    }
    emitLog(message, stream = 'stdout') {
        this.window.webContents.send('service:log', {
            stream,
            message,
            timestamp: Date.now(),
        });
    }
    emitError(message) {
        this.window.webContents.send('service:error', {
            message,
            timestamp: Date.now(),
        });
    }
    setStatus(status) {
        this.status = status;
        this.window.webContents.send('service:status', {
            status,
            timestamp: Date.now(),
        });
    }
    clearStartTimer() {
        if (this.startTimer) {
            clearTimeout(this.startTimer);
            this.startTimer = null;
        }
    }
    handleProcessOutput(message, stream) {
        this.emitLog(message, stream);
        if (this.status === 'starting' && /WebClawProxy 服务已启动|地址:\s*http:\/\/localhost:/u.test(message)) {
            this.clearStartTimer();
            this.setStatus('running');
        }
    }
    forceKillCurrentProcess() {
        if (!this.proc)
            return;
        const pid = this.proc.pid;
        if (pid) {
            try {
                process.kill(-pid, 'SIGKILL');
                return;
            }
            catch {
                // fall through
            }
        }
        this.proc.kill('SIGKILL');
    }
}
exports.ServiceManager = ServiceManager;
