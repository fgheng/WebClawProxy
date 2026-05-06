import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ClientSessionData, ClientSessionMessage } from '../types';

/**
 * 文件系统会话存储（Node.js 环境）
 *
 * 将会话数据持久化到 ~/.webclaw/sessions/ 目录。
 * 每个 session 是一个 JSON 文件。
 */
export class FileSessionStore {
  private rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? path.join(os.homedir(), '.webclaw', 'sessions');
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
    }
  }

  save(sessionId: string, data: ClientSessionData): void {
    const filePath = path.join(this.rootDir, `${sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  load(sessionId: string): ClientSessionData | null {
    const filePath = path.join(this.rootDir, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return null;
    }
  }

  list(): Array<{ id: string; lastActiveAt: number }> {
    const files = fs.readdirSync(this.rootDir).filter((f) => f.endsWith('.json'));
    return files.map((f) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(this.rootDir, f), 'utf-8'));
        return { id: f.replace('.json', ''), lastActiveAt: data.lastActiveAt ?? 0 };
      } catch {
        return { id: f.replace('.json', ''), lastActiveAt: 0 };
      }
    }).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  delete(sessionId: string): boolean {
    const filePath = path.join(this.rootDir, `${sessionId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }
}