import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ClientRouteMode } from './types';
import { ProviderKey } from './provider-models';

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
    rootDir: path.join(os.homedir(), '.webclaw', 'client-core'),
  },
};

type PartialRuntimeConfig = Partial<{
  api: Partial<ClientCoreRuntimeConfig['api']>;
  defaults: Partial<ClientCoreRuntimeConfig['defaults']>;
  storage: Partial<ClientCoreRuntimeConfig['storage']>;
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
  };
}

export function defaultClientCoreConfigPath(): string {
  return path.join(os.homedir(), '.webclaw', 'client-core.json');
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
  return merged;
}
