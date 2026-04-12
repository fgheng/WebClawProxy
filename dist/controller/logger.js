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
exports.initServiceLogger = initServiceLogger;
exports.isDebugLoggingEnabled = isDebugLoggingEnabled;
exports.logDebug = logDebug;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
let loggerInitialized = false;
let debugEnabled = false;
let stream = null;
function loadLoggingConfig() {
    try {
        const configPath = path.join(process.cwd(), 'config', 'default.json');
        const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const logging = (raw.logging ?? {});
        return {
            enabled: logging.enabled !== false,
            debug: Boolean(logging.debug),
            dir: typeof logging.dir === 'string' && logging.dir.trim() ? logging.dir : './data/logs',
            file_prefix: typeof logging.file_prefix === 'string' && logging.file_prefix.trim()
                ? logging.file_prefix
                : 'webclaw-proxy',
        };
    }
    catch {
        return {
            enabled: true,
            debug: false,
            dir: './data/logs',
            file_prefix: 'webclaw-proxy',
        };
    }
}
function toLine(level, args) {
    const time = new Date().toISOString();
    const msg = args
        .map((a) => {
        if (typeof a === 'string')
            return a;
        try {
            return JSON.stringify(a);
        }
        catch {
            return String(a);
        }
    })
        .join(' ');
    return `[${time}] [${level}] ${msg}\n`;
}
function initServiceLogger() {
    if (loggerInitialized)
        return;
    loggerInitialized = true;
    const cfg = loadLoggingConfig();
    debugEnabled = cfg.debug;
    if (!cfg.enabled)
        return;
    const dir = path.isAbsolute(cfg.dir) ? cfg.dir : path.join(process.cwd(), cfg.dir);
    fs.mkdirSync(dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const filePath = path.join(dir, `${cfg.file_prefix}-${date}.log`);
    stream = fs.createWriteStream(filePath, { flags: 'a' });
    const original = {
        log: console.log.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        debug: console.debug.bind(console),
    };
    const patch = (method, level) => {
        return (...args) => {
            original[method](...args);
            if (!stream)
                return;
            try {
                stream.write(toLine(level, args));
            }
            catch {
                // ignore file write failure
            }
        };
    };
    console.log = patch('log', 'INFO');
    console.info = patch('info', 'INFO');
    console.warn = patch('warn', 'WARN');
    console.error = patch('error', 'ERROR');
    console.debug = patch('debug', 'DEBUG');
    console.log(`[Logger] 文件日志已启用: ${filePath}`);
    console.log(`[Logger] Debug 模式: ${debugEnabled ? 'ON' : 'OFF'}`);
}
function isDebugLoggingEnabled() {
    return debugEnabled;
}
function logDebug(stage, payload) {
    if (!debugEnabled)
        return;
    try {
        console.log(`[DebugFlow] stage=${stage} payload=${JSON.stringify(payload)}`);
    }
    catch {
        console.log(`[DebugFlow] stage=${stage} payload=[unserializable]`);
    }
}
//# sourceMappingURL=logger.js.map