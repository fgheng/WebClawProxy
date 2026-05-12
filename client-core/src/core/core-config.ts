import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ClientRouteMode } from './types';
import { ProviderKey } from './provider-models';
import { WebclawPaths } from './webclaw-home';

export type ClientCoreRuntimeConfig = {
  api: {
    baseUrl: string;
    timeoutMs: number;
  };
  defaults: {
    provider: ProviderKey;
    model: string;
    mode: ClientRouteMode;
    stream: boolean;
    traceEnabled: boolean;
    tracePreviewChars: number;
  };
  storage: {
    rootDir: string;
  };
  prompt: {
    /** 系统提示词，为空时从 ~/.webclaw/config/prompts/system.md 读取 */
    system: string;
  };
};

const BUILTIN_DEFAULTS: ClientCoreRuntimeConfig = {
  api: {
    baseUrl: 'http://127.0.0.1:3000',
    timeoutMs: 180000,
  },
  defaults: {
    provider: 'gpt',
    model: 'gpt-4o',
    mode: 'web',
    stream: false,
    traceEnabled: true,
    tracePreviewChars: 180,
  },
  storage: {
    rootDir: WebclawPaths.coreSessionsDir,
  },
  prompt: {
    system: readDefaultSystemPrompt(),
  },
};

type PartialRuntimeConfig = Partial<{
  api: Partial<ClientCoreRuntimeConfig['api']>;
  defaults: Partial<ClientCoreRuntimeConfig['defaults']>;
  storage: Partial<ClientCoreRuntimeConfig['storage']>;
  prompt: Partial<ClientCoreRuntimeConfig['prompt']>;
}>;

function deepMergeConfig(partial?: PartialRuntimeConfig): ClientCoreRuntimeConfig {
  return {
    api: {
      ...BUILTIN_DEFAULTS.api,
      ...(partial?.api ?? {}),
    },
    defaults: {
      ...BUILTIN_DEFAULTS.defaults,
      ...(partial?.defaults ?? {}),
    },
    storage: {
      ...BUILTIN_DEFAULTS.storage,
      ...(partial?.storage ?? {}),
    },
    prompt: {
      ...BUILTIN_DEFAULTS.prompt,
      ...(partial?.prompt ?? {}),
    },
  };
}

export function defaultClientCoreConfigPath(): string {
  return WebclawPaths.clientCoreConfig;
}

function ensureConfigFileExists(configPath: string): void {
  if (fs.existsSync(configPath)) return;
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(BUILTIN_DEFAULTS, null, 2), 'utf-8');
}

export function loadClientCoreRuntimeConfig(customPath?: string): ClientCoreRuntimeConfig {
  const configuredPath = customPath || process.env.WEBCLAW_CLIENT_CORE_CONFIG || defaultClientCoreConfigPath();
  ensureConfigFileExists(configuredPath);
  let partial: PartialRuntimeConfig | undefined;
  if (fs.existsSync(configuredPath)) {
    try {
      partial = JSON.parse(fs.readFileSync(configuredPath, 'utf-8')) as PartialRuntimeConfig;
    } catch {
      partial = undefined;
    }
  }
  const merged = deepMergeConfig(partial);
  if (!path.isAbsolute(merged.storage.rootDir)) {
    merged.storage.rootDir = path.resolve(process.cwd(), merged.storage.rootDir);
  }
  // 如果 prompt.system 配置为空，从 system.md 文件加载默认值
  if (!merged.prompt.system) {
    merged.prompt.system = readDefaultSystemPrompt();
  }
  return merged;
}

/**
 * 从 ~/.webclaw/config/prompts/system.md 读取默认系统提示词。
 * 如果文件不存在，返回空字符串。
 */
function readDefaultSystemPrompt(): string {
  const systemMdPath = path.join(WebclawPaths.promptsDir, 'system.md');
  try {
    if (fs.existsSync(systemMdPath)) {
      return fs.readFileSync(systemMdPath, 'utf-8').trim();
    }
  } catch {
    // ignore
  }
  return '';
}
