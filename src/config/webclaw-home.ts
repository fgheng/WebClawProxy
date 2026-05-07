import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * WebClaw 统一主目录
 *
 * 所有配置和运行时数据均存放于此目录下：
 *   ~/.webclaw/config/   - 配置文件（main config、login-probes、prompts）
 *   ~/.webclaw/data/     - 运行时数据（sessions、logs、browser-profile 等）
 *
 * 可通过环境变量 WEBCLAW_HOME 覆盖根目录。
 */
export const WEBCLAW_HOME: string =
  process.env.WEBCLAW_HOME ?? path.join(os.homedir(), '.webclaw');

export const WebclawPaths = {
  // ── 根目录 ──────────────────────────────────────────────────────────────
  home: WEBCLAW_HOME,

  // ── 配置 ─────────────────────────────────────────────────────────────────
  configDir:        path.join(WEBCLAW_HOME, 'config'),
  mainConfig:       path.join(WEBCLAW_HOME, 'config', 'default.json'),
  loginProbesDir:   path.join(WEBCLAW_HOME, 'config', 'login-probes'),
  promptsDir:       path.join(WEBCLAW_HOME, 'config', 'prompts'),
  clientCoreConfig: path.join(WEBCLAW_HOME, 'config', 'client-core.json'),

  // ── 数据 ─────────────────────────────────────────────────────────────────
  dataDir:          path.join(WEBCLAW_HOME, 'data'),
  sessionsDir:      path.join(WEBCLAW_HOME, 'data', 'sessions'),
  coreSessionsDir:  path.join(WEBCLAW_HOME, 'data', 'core-sessions'),
  proxySessions:    path.join(WEBCLAW_HOME, 'data', 'proxy-sessions.json'),
  conversationsDir: path.join(WEBCLAW_HOME, 'data', 'conversations'),
  sessionIndexDir:  path.join(WEBCLAW_HOME, 'data', 'session-index'),
  browserProfile:   path.join(WEBCLAW_HOME, 'data', 'browser-profile'),
  electronDir:      path.join(WEBCLAW_HOME, 'data', 'electron'),
  logsDir:          path.join(WEBCLAW_HOME, 'data', 'logs'),
} as const;

/**
 * 确保所有 webclaw 目录存在（首次启动时调用）
 */
export function ensureWebclawDirs(): void {
  const dirs = [
    WebclawPaths.configDir,
    WebclawPaths.loginProbesDir,
    WebclawPaths.promptsDir,
    WebclawPaths.dataDir,
    WebclawPaths.sessionsDir,
    WebclawPaths.coreSessionsDir,
    WebclawPaths.conversationsDir,
    WebclawPaths.sessionIndexDir,
    WebclawPaths.browserProfile,
    WebclawPaths.electronDir,
    WebclawPaths.logsDir,
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 首次启动时将项目内 config/ 和 prompts/ 复制到 ~/.webclaw/config/
 * 如果目标已存在则跳过，不覆盖用户的自定义配置。
 *
 * @param projectRoot  项目根目录（含 config/ 和 prompts/ 子目录）
 */
export function initConfigFromProject(projectRoot: string): void {
  ensureWebclawDirs();

  // 复制 config/default.json
  const srcConfig = path.join(projectRoot, 'config', 'default.json');
  if (!fs.existsSync(WebclawPaths.mainConfig) && fs.existsSync(srcConfig)) {
    fs.copyFileSync(srcConfig, WebclawPaths.mainConfig);
  }

  // 复制 config/login-probes/
  const srcProbes = path.join(projectRoot, 'config', 'login-probes');
  copyDirIfNotExists(srcProbes, WebclawPaths.loginProbesDir);

  // 复制 prompts/
  const srcPrompts = path.join(projectRoot, 'prompts');
  copyDirIfNotExists(srcPrompts, WebclawPaths.promptsDir);
}

/**
 * 复制目录内容到目标目录（仅复制目标中不存在的文件）
 */
function copyDirIfNotExists(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcEntry = path.join(src, entry.name);
    const destEntry = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirIfNotExists(srcEntry, destEntry);
    } else if (!fs.existsSync(destEntry)) {
      fs.copyFileSync(srcEntry, destEntry);
    }
  }
}
