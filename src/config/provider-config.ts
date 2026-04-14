import type { SiteKey } from '../web-driver/types';
import { loadAppConfig } from './app-config';

export type ProviderMode = 'web' | 'forward';

export type WebModeConfig = {
  site?: string;
  input_max_chars?: number;
};

export type ForwardModeConfig = {
  base_url?: string;
  api_key?: string;
  headers?: Record<string, string>;
  timeout_ms?: number;
  upstream_model_map?: Record<string, string>;
};

export type RawProviderConfig = {
  default_mode?: ProviderMode;
  models?: string[];
  web?: WebModeConfig;
  forward?: ForwardModeConfig;

  // legacy flat fields
  mode?: ProviderMode;
  site?: string;
  input_max_chars?: number;
  base_url?: string;
  api_key?: string;
  headers?: Record<string, string>;
  timeout_ms?: number;
  upstream_model_map?: Record<string, string>;
};

export type NormalizedProviderConfig = {
  default_mode: ProviderMode;
  models: string[];
  web: WebModeConfig;
  forward: ForwardModeConfig;
};

const appConfig = loadAppConfig() as {
  providers?: Record<string, RawProviderConfig>;
};

const WEB_SITE_KEYS: SiteKey[] = ['gpt', 'qwen', 'deepseek', 'kimi', 'glm'];

export function getRawProviderConfigMap(): Record<string, RawProviderConfig> {
  return (appConfig.providers ?? {}) as Record<string, RawProviderConfig>;
}

export function isSiteKey(value: string): value is SiteKey {
  return WEB_SITE_KEYS.includes(value as SiteKey);
}

export function normalizeProviderConfig(provider: RawProviderConfig | undefined): NormalizedProviderConfig {
  const web: WebModeConfig = {
    site: provider?.web?.site ?? provider?.site,
    input_max_chars: provider?.web?.input_max_chars ?? provider?.input_max_chars,
  };

  const forward: ForwardModeConfig = {
    base_url: provider?.forward?.base_url ?? provider?.base_url,
    api_key: provider?.forward?.api_key ?? provider?.api_key,
    headers: provider?.forward?.headers ?? provider?.headers,
    timeout_ms: provider?.forward?.timeout_ms ?? provider?.timeout_ms,
    upstream_model_map: provider?.forward?.upstream_model_map ?? provider?.upstream_model_map,
  };

  const default_mode =
    provider?.default_mode ??
    provider?.mode ??
    (forward.base_url && forward.api_key ? 'forward' : 'web');

  return {
    default_mode,
    models: provider?.models ?? [],
    web,
    forward,
  };
}

export function getNormalizedProviderConfigMap(): Record<string, NormalizedProviderConfig> {
  return Object.fromEntries(
    Object.entries(getRawProviderConfigMap()).map(([providerKey, provider]) => [
      providerKey,
      normalizeProviderConfig(provider),
    ])
  );
}

export function getNormalizedProviderConfig(providerKey: string): NormalizedProviderConfig | undefined {
  const provider = getRawProviderConfigMap()[providerKey];
  if (!provider) return undefined;
  return normalizeProviderConfig(provider);
}
