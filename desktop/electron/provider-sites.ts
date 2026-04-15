import * as fs from 'fs';
import * as path from 'path';

export type ProviderKey = 'gpt' | 'qwen' | 'deepseek' | 'kimi' | 'glm' | 'claude' | 'doubao';

const PROVIDERS: ProviderKey[] = ['gpt', 'qwen', 'deepseek', 'kimi', 'glm', 'claude', 'doubao'];

type ProviderConfig = {
  site?: string;
  web?: {
    site?: string;
  };
};

export function readProviderSites(projectRoot: string): Record<ProviderKey, string> {
  const configPath = path.join(projectRoot, 'config', 'default.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
    providers?: Record<string, ProviderConfig>;
  };

  const result = {} as Record<ProviderKey, string>;
  for (const provider of PROVIDERS) {
    const providerConfig = config.providers?.[provider];
    const site = providerConfig?.web?.site ?? providerConfig?.site;
    if (typeof site === 'string' && site.trim()) {
      result[provider] = site.trim();
    }
  }

  return result;
}

export function getProviderKeys(): ProviderKey[] {
  return [...PROVIDERS];
}
