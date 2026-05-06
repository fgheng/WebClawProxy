import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ClientSessionData, ClientSessionSummary, ClientSessionStore, ClientRouteMode } from '../core/types';
import type { ProviderKey } from '../core/provider-models';

/**
 * 文件系统会话存储（Node.js 环境）
 *
 * 实现 ClientSessionStore 接口，供 Agent Service 中的 WebClawClientCore 使用。
 * 将会话数据持久化到 ~/.webclaw/sessions/ 目录。
 */
export class FileSessionStore implements ClientSessionStore {
  private rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? path.join(os.homedir(), '.webclaw', 'sessions');
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
    }
  }

  async listSessions(): Promise<ClientSessionSummary[]> {
    const files = fs.readdirSync(this.rootDir).filter((f) => f.endsWith('.json'));
    return files.map((f) => {
      try {
        const data: ClientSessionData = JSON.parse(fs.readFileSync(path.join(this.rootDir, f), 'utf-8'));
        return {
          id: data.id,
          title: data.title ?? data.id,
          provider: (data.provider ?? 'gpt') as ProviderKey,
          model: data.model ?? '',
          mode: (data.mode ?? 'web') as ClientRouteMode,
          createdAt: data.createdAt ?? 0,
          updatedAt: data.updatedAt ?? 0,
          messageCount: data.messages?.length ?? 0,
        };
      } catch {
        return {
          id: f.replace('.json', ''),
          title: f.replace('.json', ''),
          provider: 'gpt' as ProviderKey,
          model: '',
          mode: 'web' as ClientRouteMode,
          createdAt: 0,
          updatedAt: 0,
          messageCount: 0,
        };
      }
    }).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async loadSession(sessionId: string): Promise<ClientSessionData | null> {
    const filePath = path.join(this.rootDir, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return null;
    }
  }

  async saveSession(session: ClientSessionData): Promise<void> {
    const filePath = path.join(this.rootDir, `${session.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }
}