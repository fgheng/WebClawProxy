import * as fs from 'fs';
import * as path from 'path';

interface LoggingConfig {
  enabled: boolean;
  debug: boolean;
  dir: string;
  file_prefix: string;
}

let loggerInitialized = false;
let debugEnabled = false;
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
    };
  } catch {
    return {
      enabled: true,
      debug: false,
      dir: './data/logs',
      file_prefix: 'webclaw-proxy',
    };
  }
}

function toLine(level: string, args: unknown[]): string {
  const time = new Date().toISOString();
  const msg = args
    .map((a) => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
  return `[${time}] [${level}] ${msg}\n`;
}

export function initServiceLogger(): void {
  if (loggerInitialized) return;
  loggerInitialized = true;

  const cfg = loadLoggingConfig();
  debugEnabled = cfg.debug;
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
}

export function isDebugLoggingEnabled(): boolean {
  return debugEnabled;
}

export function logDebug(stage: string, payload: Record<string, unknown>): void {
  if (!debugEnabled) return;
  try {
    console.log(`[DebugFlow] stage=${stage} payload=${JSON.stringify(payload)}`);
  } catch {
    console.log(`[DebugFlow] stage=${stage} payload=[unserializable]`);
  }
}
