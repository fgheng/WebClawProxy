export type ProviderKey = 'gpt' | 'qwen' | 'deepseek' | 'kimi' | 'glm';
export type ProviderModelCatalog = {
    modelToProvider: Map<string, ProviderKey>;
    providerToModels: Map<ProviderKey, string[]>;
};
export declare function createEmptyProviderModelCatalog(): ProviderModelCatalog;
export declare function inferProviderFromModel(model: string, catalog: ProviderModelCatalog): ProviderKey;
export declare function getDefaultModelForProvider(provider: ProviderKey, catalog: ProviderModelCatalog): string;
//# sourceMappingURL=provider-models.d.ts.map