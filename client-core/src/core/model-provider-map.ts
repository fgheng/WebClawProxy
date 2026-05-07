import * as fs from 'fs';
import * as path from 'path';
import { ProviderKey, ProviderModelCatalog } from './provider-models';
import { WebclawPaths } from './webclaw-home';

type ProviderConfig = {
  models?: string[];
};

const PROVIDERS: ProviderKey[] = ['gpt', 'qwen', 'deepseek', 'kimi', 'glm', 'claude', 'doubao'];

export function loadProviderModelCatalog(): ProviderModelCatalog {
  const modelToProvider = new Map<string, ProviderKey>();
  const providerToModels = new Map<ProviderKey, string[]>();

  for (const provider of PROVIDERS) {
    providerToModels.set(provider, []);
  }

  try {
    const configPath = WebclawPaths.mainConfig;
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as {
      providers?: Record<string, ProviderConfig>;
    };

    for (const provider of PROVIDERS) {
      const models = config.providers?.[provider]?.models ?? [];
      providerToModels.set(provider, models);
      for (const model of models) {
        modelToProvider.set(model.toLowerCase(), provider);
      }
    }
  } catch {
    // 忽略配置读取失败，退回前缀推断
  }

  return { modelToProvider, providerToModels };
}
