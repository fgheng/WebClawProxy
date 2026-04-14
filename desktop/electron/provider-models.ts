import * as fs from 'fs';
import * as path from 'path';
import type { ProviderKey } from './provider-sites';

type ProviderConfig = {
  models?: string[];
};

export function readProviderModels(projectRoot: string): Record<ProviderKey, string[]> {
  const configPath = path.join(projectRoot, 'config', 'default.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
    providers?: Record<string, ProviderConfig>;
  };

  return {
    gpt: config.providers?.gpt?.models ?? [],
    qwen: config.providers?.qwen?.models ?? [],
    deepseek: config.providers?.deepseek?.models ?? [],
    kimi: config.providers?.kimi?.models ?? [],
    glm: config.providers?.glm?.models ?? [],
  };
}
