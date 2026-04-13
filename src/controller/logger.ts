import * as fs from 'fs';
import * as path from 'path';

interface LoggingConfig {
  enabled: boolean;
  debug: boolean;
  dir: string;
  file_prefix: string;
  pretty_json: boolean;
  pretty_json_indent: number;
  request_body_truncate_enabled: boolean;
  request_body_max_chars: number;
}

let loggerInitialized = false;
let debugEnabled = false;
let prettyJsonEnabled = false;
let prettyJsonIndent = 2;
let requestBodyTruncateEnabled = true;
let requestBodyMaxChars = 5000;
let stream: fs.WriteStream | null = null;

function loadLoggingConfig(): LoggingConfig {
  try {
    const configPath = path.join(process.cwd(), 'config', 'default.json');
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, any>;
    const logging = (raw.logging ?? {}) as Record<string, any>;

    return {
      enabled: logging.enabled !== false,
      debug: Boolean(logging.debug),
      dir: typeof logging.dir === 'string' && logging.dir.trim() ? logging.dir : './data/logs',
      file_prefix:
        typeof logging.file_prefix === 'string' && logging.file_prefix.trim()
          ? logging.file_prefix
          : 'webclaw-proxy',
      pretty_json: Boolean(logging.pretty_json),
      pretty_json_indent:
        typeof logging.pretty_json_indent === 'number' && logging.pretty_json_indent > 0
          ? Math.floor(logging.pretty_json_indent)
          : 2,
      request_body_truncate_enabled: logging.request_body_truncate_enabled !== false,
      request_body_max_chars:
        typeof logging.request_body_max_chars === 'number' && logging.request_body_max_chars > 0
          ? Math.floor(logging.request_body_max_chars)
          : 5000,
    };
  } catch {
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

function stringifyMaybeJson(value: unknown): string {
  if (typeof value === 'string') return value;
  return prettyJsonEnabled
    ? JSON.stringify(value, null, prettyJsonIndent)
    : JSON.stringify(value);
}

export function stringifyLogPayload(payload: unknown): string {
  try {
    return stringifyMaybeJson(payload);
  } catch {
    return '[unserializable]';
  }
}

function toLine(level: string, args: unknown[]): string {
  const time = new Date().toISOString();
  const msg = args.map((a) => stringifyLogPayload(a)).join(' ');
  return `[${time}] [${level}] ${msg}\n`;
}

export function initServiceLogger(): void {
  if (loggerInitialized) return;
  loggerInitialized = true;

  const cfg = loadLoggingConfig();
  debugEnabled = cfg.debug;
  prettyJsonEnabled = cfg.pretty_json;
  prettyJsonIndent = cfg.pretty_json_indent;
  requestBodyTruncateEnabled = cfg.request_body_truncate_enabled;
  requestBodyMaxChars = cfg.request_body_max_chars;
  if (!cfg.enabled) return;

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

  const patch = (method: keyof typeof original, level: string) => {
    return (...args: unknown[]) => {
      original[method](...args);
      if (!stream) return;
      try {
        stream.write(toLine(level, args));
      } catch {
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
  console.log(
    `[Logger] JSON 格式化: ${prettyJsonEnabled ? `ON (indent=${prettyJsonIndent})` : 'OFF'}`
  );
  console.log(
    `[Logger] 请求体截断: ${requestBodyTruncateEnabled ? `ON (max=${requestBodyMaxChars})` : 'OFF'}`
  );
}

export function formatRequestBodyPreview(payload: unknown): string {
  const raw = stringifyLogPayload(payload);
  if (!requestBodyTruncateEnabled) {
    return raw;
  }
  return raw.slice(0, requestBodyMaxChars);
}

export function logDebug(stage: string, payload: Record<string, unknown>): void {
  if (!debugEnabled) return;
  console.log(`[DebugFlow] stage=${stage} payload=${stringifyLogPayload(payload)}`);
}
