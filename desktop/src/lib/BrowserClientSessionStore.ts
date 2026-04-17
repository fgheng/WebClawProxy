import type {
  ClientSessionData,
  ClientSessionStore,
  ClientSessionSummary,
} from '../../../client-core/src/core/types';

type SessionIndex = {
  sessions: ClientSessionSummary[];
};

export class BrowserClientSessionStore implements ClientSessionStore {
  private readonly indexKey = 'webclaw:client-core:sessions:index';
  private readonly sessionPrefix = 'webclaw:client-core:sessions:item:';

  async listSessions(): Promise<ClientSessionSummary[]> {
    const index = this.readIndex();
    return [...index.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async loadSession(sessionId: string): Promise<ClientSessionData | null> {
    const raw = this.storage().getItem(this.sessionKey(sessionId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ClientSessionData;
    } catch {
      return null;
    }
  }

  async saveSession(session: ClientSessionData): Promise<void> {
    this.storage().setItem(this.sessionKey(session.id), JSON.stringify(session));
    const index = this.readIndex();
    const summary: ClientSessionSummary = {
      id: session.id,
      title: session.title,
      provider: session.provider,
      model: session.model,
      mode: session.mode,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
    };
    const idx = index.sessions.findIndex((item) => item.id === session.id);
    if (idx >= 0) index.sessions[idx] = summary;
    else index.sessions.push(summary);
    this.writeIndex(index);
  }

  private storage(): Storage {
    return window.localStorage;
  }

  private sessionKey(sessionId: string): string {
    return `${this.sessionPrefix}${sessionId}`;
  }

  private readIndex(): SessionIndex {
    const raw = this.storage().getItem(this.indexKey);
    if (!raw) return { sessions: [] };
    try {
      const parsed = JSON.parse(raw) as SessionIndex;
      return { sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] };
    } catch {
      return { sessions: [] };
    }
  }

  private writeIndex(index: SessionIndex): void {
    this.storage().setItem(this.indexKey, JSON.stringify(index));
  }
}
