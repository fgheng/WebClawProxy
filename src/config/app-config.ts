import * as fs from 'fs';
import * as path from 'path';
import { resolvePromptRefsInValue } from './prompt-loader';

const configPath = path.join(process.cwd(), 'config', 'default.json');
const promptsRoot = path.join(process.cwd(), 'prompts');

let cachedConfig: Record<string, any> | null = null;

export function loadAppConfig(): Record<string, any> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, any>;
  cachedConfig = resolvePromptRefsInValue(raw, promptsRoot);
  return cachedConfig;
}

export function getAppConfigPath(): string {
  return configPath;
}

export function getPromptsRoot(): string {
  return promptsRoot;
}

export function clearAppConfigCache(): void {
  cachedConfig = null;
}
