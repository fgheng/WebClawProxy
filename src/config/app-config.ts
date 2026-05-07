import * as fs from 'fs';
import * as path from 'path';
import { resolvePromptRefsInValue } from './prompt-loader';
import { WebclawPaths, initConfigFromProject } from './webclaw-home';

// 首次启动时将项目内 config/ 和 prompts/ 复制到 ~/.webclaw/config/
initConfigFromProject(process.cwd());

const configPath = WebclawPaths.mainConfig;
const promptsRoot = WebclawPaths.promptsDir;

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
