"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRawProviderConfigMap = getRawProviderConfigMap;
exports.isSiteKey = isSiteKey;
exports.normalizeProviderConfig = normalizeProviderConfig;
exports.getNormalizedProviderConfigMap = getNormalizedProviderConfigMap;
exports.getNormalizedProviderConfig = getNormalizedProviderConfig;
const app_config_1 = require("./app-config");
const appConfig = (0, app_config_1.loadAppConfig)();
const WEB_SITE_KEYS = ['gpt', 'qwen', 'deepseek', 'kimi', 'glm'];
function getRawProviderConfigMap() {
    return (appConfig.providers ?? {});
}
function isSiteKey(value) {
    return WEB_SITE_KEYS.includes(value);
}
function normalizeProviderConfig(provider) {
    const web = {
        site: provider?.web?.site ?? provider?.site,
        input_max_chars: provider?.web?.input_max_chars ?? provider?.input_max_chars,
    };
    const forward = {
        base_url: provider?.forward?.base_url ?? provider?.base_url,
        api_key: provider?.forward?.api_key ?? provider?.api_key,
        headers: provider?.forward?.headers ?? provider?.headers,
        timeout_ms: provider?.forward?.timeout_ms ?? provider?.timeout_ms,
        upstream_model_map: provider?.forward?.upstream_model_map ?? provider?.upstream_model_map,
    };
    const default_mode = provider?.default_mode ??
        provider?.mode ??
        (forward.base_url && forward.api_key ? 'forward' : 'web');
    return {
        default_mode,
        models: provider?.models ?? [],
        web,
        forward,
    };
}
function getNormalizedProviderConfigMap() {
    return Object.fromEntries(Object.entries(getRawProviderConfigMap()).map(([providerKey, provider]) => [
        providerKey,
        normalizeProviderConfig(provider),
    ]));
}
function getNormalizedProviderConfig(providerKey) {
    const provider = getRawProviderConfigMap()[providerKey];
    if (!provider)
        return undefined;
    return normalizeProviderConfig(provider);
}
//# sourceMappingURL=provider-config.js.map