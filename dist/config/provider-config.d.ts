import type { SiteKey } from '../web-driver/types';
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
export declare function getRawProviderConfigMap(): Record<string, RawProviderConfig>;
export declare function isSiteKey(value: string): value is SiteKey;
export declare function normalizeProviderConfig(provider: RawProviderConfig | undefined): NormalizedProviderConfig;
export declare function getNormalizedProviderConfigMap(): Record<string, NormalizedProviderConfig>;
export declare function getNormalizedProviderConfig(providerKey: string): NormalizedProviderConfig | undefined;
//# sourceMappingURL=provider-config.d.ts.map