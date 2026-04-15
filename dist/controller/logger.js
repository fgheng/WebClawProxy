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
exports.stringifyLogPayload = stringifyLogPayload;
exports.initServiceLogger = initServiceLogger;
exports.formatRequestBodyPreview = formatRequestBodyPreview;
exports.logDebug = logDebug;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const app_config_1 = require("../config/app-config");
let loggerInitialized = false;
let debugEnabled = false;
let prettyJsonEnabled = false;
let prettyJsonIndent = 2;
let requestBodyTruncateEnabled = true;
let requestBodyMaxChars = 5000;
let stream = null;
function loadLoggingConfig() {
    try {
        const raw = (0, app_config_1.loadAppConfig)();
        const logging = (raw.logging ?? {});
        return {
            enabled: logging.enabled !== false,
            debug: Boolean(logging.debug),
            dir: typeof logging.dir === 'string' && logging.dir.trim() ? logging.dir : './data/logs',
            file_prefix: typeof logging.file_prefix === 'string' && logging.file_prefix.trim()
                ? logging.file_prefix
                : 'webclaw-proxy',
            pretty_json: Boolean(logging.pretty_json),
            pretty_json_indent: typeof logging.pretty_json_indent === 'number' && logging.pretty_json_indent > 0
                ? Math.floor(logging.pretty_json_indent)
                : 2,
            request_body_truncate_enabled: logging.request_body_truncate_enabled !== false,
            request_body_max_chars: typeof logging.request_body_max_chars === 'number' && logging.request_body_max_chars > 0
                ? Math.floor(logging.request_body_max_chars)
                : 5000,
        };
    }
    catch {
        return {
            enabled: true,
            debug: false,
            dir: './data/logs',
            file_prefix: 'webclaw-proxy',
            pretty_json: false,
            pretty_json_indent: 2,
            request_body_truncate_enabled: true,
            request_body_max_chars: 5000,
        };
    }
}
function stringifyMaybeJson(value) {
    if (typeof value === 'string')
        return value;
    return prettyJsonEnabled
        ? JSON.stringify(value, null, prettyJsonIndent)
        : JSON.stringify(value);
}
function stringifyLogPayload(payload) {
    try {
        return stringifyMaybeJson(payload);
    }
    catch {
        return '[unserializable]';
    }
}
function toLine(level, args) {
    const time = new Date().toISOString();
    const msg = args.map((a) => stringifyLogPayload(a)).join(' ');
    return `[${time}] [${level}] ${msg}\n`;
}
function initServiceLogger() {
    if (loggerInitialized)
        return;
    loggerInitialized = true;
    const cfg = loadLoggingConfig();
    debugEnabled = cfg.debug;
    prettyJsonEnabled = cfg.pretty_json;
    prettyJsonIndent = cfg.pretty_json_indent;
    requestBodyTruncateEnabled = cfg.request_body_truncate_enabled;
    requestBodyMaxChars = cfg.request_body_max_chars;
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
    console.log(`[Logger] JSON 格式化: ${prettyJsonEnabled ? `ON (indent=${prettyJsonIndent})` : 'OFF'}`);
    console.log(`[Logger] 请求体截断: ${requestBodyTruncateEnabled ? `ON (max=${requestBodyMaxChars})` : 'OFF'}`);
}
function formatRequestBodyPreview(payload) {
    const raw = stringifyLogPayload(payload);
    if (!requestBodyTruncateEnabled) {
        return raw;
    }
    return raw.slice(0, requestBodyMaxChars);
}
function logDebug(stage, payload) {
    if (!debugEnabled)
        return;
    console.log(`[DebugFlow] stage=${stage} payload=${stringifyLogPayload(payload)}`);
}
//# sourceMappingURL=logger.js.map