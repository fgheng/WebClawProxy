import * as fs from 'fs';
import * as path from 'path';
import { ConversationStore } from './ConversationStore';
import { ConversationRecord, ConversationSnapshot } from './types';
import { loadAppConfig } from '../config/app-config';

type StoreIndex = {
  conversationIds: string[];
  sessionIdToConversationId: Record<string, string>;
  latestHashToConversationId: Record<string, string>;
};

function createEmptyIndex(): StoreIndex {
  return {
    conversationIds: [],
    sessionIdToConversationId: {},
    latestHashToConversationId: {},
  };
}

export class FileConversationStore implements ConversationStore {
  private readonly rootDir: string;
  private readonly recordsDir: string;
  private readonly indexPath: string;

  constructor(rootDir?: string) {
    const resolved = this.resolveRootDir(rootDir);
    this.rootDir = resolved;
    this.recordsDir = path.join(resolved, 'records');
    this.indexPath = path.join(resolved, 'index.json');
    this.ensureStoreDirs();
  }

  findByConversationId(conversationId: string): ConversationRecord | null {
    const filePath = this.getRecordPath(conversationId);
    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as ConversationRecord;
    } catch {
      return null;
    }
  }

  findBySessionId(sessionId: string): ConversationRecord | null {
    const index = this.loadIndex();
    const conversationId = index.sessionIdToConversationId[sessionId];
    return conversationId ? this.findByConversationId(conversationId) : null;
  }

  findByLatestHash(latestHash: string): ConversationRecord | null {
    const index = this.loadIndex();
    const conversationId = index.latestHashToConversationId[latestHash];
    return conversationId ? this.findByConversationId(conversationId) : null;
  }

  save(record: ConversationRecord): void {
    this.ensureStoreDirs();
    const previous = this.findByConversationId(record.conversationId);
    const index = this.loadIndex();

    if (!index.conversationIds.includes(record.conversationId)) {
      index.conversationIds.push(record.conversationId);
    }

    this.removeStaleIndexes(index, previous, record.conversationId);

    if (record.identity.sessionId) {
      index.sessionIdToConversationId[record.identity.sessionId] = record.conversationId;
    }

    if (record.identity.latestHash) {
      index.latestHashToConversationId[record.identity.latestHash] = record.conversationId;
    }

    fs.writeFileSync(
      this.getRecordPath(record.conversationId),
      JSON.stringify(record, null, 2),
      'utf-8'
    );
    this.saveIndex(index);
  }

  delete(conversationId: string): boolean {
    const existing = this.findByConversationId(conversationId);
    if (!existing) return false;

    const index = this.loadIndex();
    index.conversationIds = index.conversationIds.filter((id) => id !== conversationId);
    this.removeStaleIndexes(index, existing, conversationId);

    const filePath = this.getRecordPath(conversationId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    this.saveIndex(index);
    return true;
  }

  listByProvider(providerKey?: string): ConversationRecord[] {
    const index = this.loadIndex();
    const records = index.conversationIds
      .map((conversationId) => this.findByConversationId(conversationId))
      .filter((record): record is ConversationRecord => Boolean(record));

    if (!providerKey) return records;
    return records.filter((record) => record.providerKey === providerKey);
  }

  listSnapshots(providerKey?: string): ConversationSnapshot[] {
    return this.listByProvider(providerKey).map((record) => ({
      conversationId: record.conversationId,
      mode: record.mode,
      providerKey: record.providerKey,
      model: record.model,
      rounds: record.stats.rounds,
      createdAt: record.stats.createdAt,
      lastActiveAt: record.stats.lastActiveAt,
      linked: record.linkage.linked,
      webUrls: [...record.linkage.webUrls],
      messageCount: record.messages.length,
      lastMessage: record.messages.length > 0 ? record.messages[record.messages.length - 1] : null,
    }));
  }

  cleanupExpired(now = Date.now()): number {
    let cleaned = 0;
    for (const record of this.listByProvider()) {
      const ttlMs = record.retention.ttlMs;
      if (ttlMs == null || ttlMs <= 0) continue;
      if (now - record.stats.lastActiveAt <= ttlMs) continue;
      if (this.delete(record.conversationId)) {
        cleaned++;
      }
    }
    return cleaned;
  }

  private ensureStoreDirs(): void {
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
    }
    if (!fs.existsSync(this.recordsDir)) {
      fs.mkdirSync(this.recordsDir, { recursive: true });
    }
  }

  private resolveRootDir(input?: string): string {
    if (typeof input === 'string' && input.trim()) {
      const raw = input.trim();
      return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
    }

    const config = loadAppConfig();
    const dataRootDir = typeof config?.data?.root_dir === 'string' ? config.data.root_dir : '.data';
    const root = path.join(dataRootDir, 'conversations');
    return path.isAbsolute(root) ? root : path.resolve(process.cwd(), root);
  }

  private getRecordPath(conversationId: string): string {
    return path.join(this.recordsDir, `${conversationId}.json`);
  }

  private loadIndex(): StoreIndex {
    if (!fs.existsSync(this.indexPath)) {
      return createEmptyIndex();
    }

    try {
      const raw = fs.readFileSync(this.indexPath, 'utf-8').trim();
      if (!raw) return createEmptyIndex();
      const parsed = JSON.parse(raw) as Partial<StoreIndex>;
      return {
        conversationIds: Array.isArray(parsed.conversationIds) ? parsed.conversationIds : [],
        sessionIdToConversationId:
          parsed.sessionIdToConversationId && typeof parsed.sessionIdToConversationId === 'object'
            ? parsed.sessionIdToConversationId
            : {},
        latestHashToConversationId:
          parsed.latestHashToConversationId && typeof parsed.latestHashToConversationId === 'object'
            ? parsed.latestHashToConversationId
            : {},
      };
    } catch {
      return createEmptyIndex();
    }
  }

  private saveIndex(index: StoreIndex): void {
    this.ensureStoreDirs();
    fs.writeFileSync(this.indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  private removeStaleIndexes(
    index: StoreIndex,
    existing: ConversationRecord | null,
    conversationId: string
  ): void {
    if (existing?.identity.sessionId) {
      const mapped = index.sessionIdToConversationId[existing.identity.sessionId];
      if (mapped === conversationId) {
        delete index.sessionIdToConversationId[existing.identity.sessionId];
      }
    }

    if (existing?.identity.latestHash) {
      const mapped = index.latestHashToConversationId[existing.identity.latestHash];
      if (mapped === conversationId) {
        delete index.latestHashToConversationId[existing.identity.latestHash];
      }
    }
  }
}
