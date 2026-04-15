"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShellTerminalManager = void 0;
const node_pty_1 = require("node-pty");
const fs = __importStar(require("fs"));
class ShellTerminalManager {
    constructor(cwd, window) {
        this.cwd = cwd;
        this.window = window;
        this.proc = null;
        this.status = 'stopped';
        this.lastStartFailureAt = 0;
        this.shellPath = this.resolveShellPath();
    }
    async ensureStarted() {
        if (!this.proc && Date.now() - this.lastStartFailureAt > 1500) {
            try {
                this.startProcess();
            }
            catch (error) {
                this.lastStartFailureAt = Date.now();
                this.proc = null;
                this.setStatus('stopped');
                this.emitOutput(`\r\n[SYS ] Failed to start shell ${this.shellPath}: ${error instanceof Error ? error.message : String(error)}\r\n`, 'system');
            }
        }
        return {
            status: this.status,
            shell: this.shellPath,
            cwd: this.cwd,
            pid: this.proc?.pid ?? null,
        };
    }
    async write(command) {
        await this.ensureStarted();
        if (!this.proc) {
            return;
        }
        this.proc.write(command);
    }
    async interrupt() {
        if (!this.proc)
            return;
        this.proc.write('\u0003');
    }
    async resize(cols, rows) {
        if (!this.proc)
            return;
        this.proc.resize(Math.max(20, cols), Math.max(8, rows));
    }
    startProcess() {
        this.proc = (0, node_pty_1.spawn)(this.shellPath, [], {
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
    resolveShellPath() {
        const candidates = [
            process.env.SHELL,
            '/bin/zsh',
            '/bin/bash',
            '/bin/sh',
        ]
            .map((item) => (item ?? '').trim())
            .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index);
        for (const candidate of candidates) {
            try {
                fs.accessSync(candidate, fs.constants.X_OK);
                return candidate;
            }
            catch {
                // try next candidate
            }
        }
        return '/bin/sh';
    }
    emitOutput(message, stream) {
        this.window.webContents.send('terminal:output', {
            stream,
            message,
            timestamp: Date.now(),
        });
    }
    setStatus(status) {
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
exports.ShellTerminalManager = ShellTerminalManager;
