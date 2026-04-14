export type ProviderKey = 'gpt' | 'qwen' | 'deepseek' | 'kimi' | 'glm';

export type ProviderModelCatalog = {
  modelToProvider: Map<string, ProviderKey>;
  providerToModels: Map<ProviderKey, string[]>;
};

export function createEmptyProviderModelCatalog(): ProviderModelCatalog {
  return {
    modelToProvider: new Map<string, ProviderKey>(),
    providerToModels: new Map<ProviderKey, string[]>([
      ['gpt', []],
      ['qwen', []],
      ['deepseek', []],
      ['kimi', []],
      ['glm', []],
    ]),
  };
}

export function inferProviderFromModel(
  model: string,
  catalog: ProviderModelCatalog
): ProviderKey {
  const normalized = model.toLowerCase();
  const direct = catalog.modelToProvider.get(normalized);
  if (direct) return direct;

  if (normalized.startsWith('gpt') || normalized.startsWith('o1') || normalized.startsWith('o3')) return 'gpt';
  if (normalized.startsWith('qwen')) return 'qwen';
  if (normalized.startsWith('deepseek')) return 'deepseek';
  if (normalized.startsWith('moonshot') || normalized.startsWith('kimi')) return 'kimi';
  if (normalized.startsWith('glm')) return 'glm';
  return 'gpt';
}

export function getDefaultModelForProvider(
  provider: ProviderKey,
  catalog: ProviderModelCatalog
): string {
  const models = catalog.providerToModels.get(provider) ?? [];
  return models[0] ?? provider;
}
