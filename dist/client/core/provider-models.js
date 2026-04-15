"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyProviderModelCatalog = createEmptyProviderModelCatalog;
exports.inferProviderFromModel = inferProviderFromModel;
exports.getDefaultModelForProvider = getDefaultModelForProvider;
function createEmptyProviderModelCatalog() {
    return {
        modelToProvider: new Map(),
        providerToModels: new Map([
            ['gpt', []],
            ['qwen', []],
            ['deepseek', []],
            ['kimi', []],
            ['glm', []],
        ]),
    };
}
function inferProviderFromModel(model, catalog) {
    const normalized = model.toLowerCase();
    const direct = catalog.modelToProvider.get(normalized);
    if (direct)
        return direct;
    if (normalized.startsWith('gpt') || normalized.startsWith('o1') || normalized.startsWith('o3'))
        return 'gpt';
    if (normalized.startsWith('qwen'))
        return 'qwen';
    if (normalized.startsWith('deepseek'))
        return 'deepseek';
    if (normalized.startsWith('moonshot') || normalized.startsWith('kimi'))
        return 'kimi';
    if (normalized.startsWith('glm'))
        return 'glm';
    return 'gpt';
}
function getDefaultModelForProvider(provider, catalog) {
    const models = catalog.providerToModels.get(provider) ?? [];
    return models[0] ?? provider;
}
//# sourceMappingURL=provider-models.js.map