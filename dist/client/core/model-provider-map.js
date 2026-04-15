"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadProviderModelCatalog = loadProviderModelCatalog;
const app_config_1 = require("../../config/app-config");
const PROVIDERS = ['gpt', 'qwen', 'deepseek', 'kimi', 'glm'];
function loadProviderModelCatalog() {
    const modelToProvider = new Map();
    const providerToModels = new Map();
    for (const provider of PROVIDERS) {
        providerToModels.set(provider, []);
    }
    try {
        const config = (0, app_config_1.loadAppConfig)();
        for (const provider of PROVIDERS) {
            const models = config.providers?.[provider]?.models ?? [];
            providerToModels.set(provider, models);
            for (const model of models) {
                modelToProvider.set(model.toLowerCase(), provider);
            }
        }
    }
    catch {
        // 忽略配置读取失败，退回前缀推断
    }
    return { modelToProvider, providerToModels };
}
//# sourceMappingURL=model-provider-map.js.map