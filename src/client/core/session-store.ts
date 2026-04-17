import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ClientSessionData,
  ClientSessionStore,
  ClientSessionSummary,
} from './types';
import { ProviderKey } from './provider-models';

type SessionIndex = {
  sessions: ClientSessionSummary[];
};

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function nowTs(): number {
  return Date.now();
}

function toSummary(session: ClientSessionData): ClientSessionSummary {
  return {
    id: session.id,
    title: session.title,
    provider: session.provider,
    model: session.model,
    mode: session.mode,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
  };
}

export class FileClientSessionStore implements ClientSessionStore {
  private readonly rootDir: string;
  private readonly sessionsDir: string;
  private readonly indexPath: string;

  constructor(rootDir?: string) {
    const base =
      rootDir && rootDir.trim()
        ? rootDir
        : path.join(os.homedir(), '.webclaw', 'client-core');
    this.rootDir = path.isAbsolute(base) ? base : path.resolve(process.cwd(), base);
    this.sessionsDir = path.join(this.rootDir, 'sessions');
    this.indexPath = path.join(this.rootDir, 'index.json');
    ensureDir(this.sessionsDir);
    this.ensureIndexFile();
  }

  async listSessions(): Promise<ClientSessionSummary[]> {
    const index = this.readIndex();
    return [...index.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async loadSession(sessionId: string): Promise<ClientSessionData | null> {
    const filePath = this.getSessionPath(sessionId);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ClientSessionData;
    } catch {
      return null;
    }
  }

  async saveSession(session: ClientSessionData): Promise<void> {
    const normalized: ClientSessionData = {
      ...session,
      updatedAt: session.updatedAt || nowTs(),
      messages: Array.isArray(session.messages) ? session.messages : [],
      provider: session.provider as ProviderKey,
    };
    fs.writeFileSync(this.getSessionPath(session.id), JSON.stringify(normalized, null, 2), 'utf-8');

    const index = this.readIndex();
    const summary = toSummary(normalized);
    const idx = index.sessions.findIndex((item) => item.id === summary.id);
    if (idx >= 0) index.sessions[idx] = summary;
    else index.sessions.push(summary);
    this.writeIndex(index);
  }

  private ensureIndexFile(): void {
    if (!fs.existsSync(this.indexPath)) {
      this.writeIndex({ sessions: [] });
    }
  }

  private readIndex(): SessionIndex {
    this.ensureIndexFile();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8')) as SessionIndex;
      return { sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] };
    } catch {
      return { sessions: [] };
    }
  }

  private writeIndex(index: SessionIndex): void {
    fs.writeFileSync(this.indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  private getSessionPath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.json`);
  }
}
