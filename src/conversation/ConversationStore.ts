import { ConversationRecord, ConversationSnapshot } from './types';

export interface ConversationStore {
  findByConversationId(conversationId: string): ConversationRecord | null;
  findBySessionId(sessionId: string): ConversationRecord | null;
  findByLatestHash(latestHash: string): ConversationRecord | null;
  save(record: ConversationRecord): void;
  delete(conversationId: string): boolean;
  listByProvider(providerKey?: string): ConversationRecord[];
  listSnapshots(providerKey?: string): ConversationSnapshot[];
  cleanupExpired(now?: number): number;
}
