import { v4 as uuidv4 } from 'uuid';
import { FileConversationStore } from './FileConversationStore';
import { ConversationRecord, ConversationMessage, ConversationSnapshot } from './types';
import { Message, Tool } from '../protocol/types';
import { computeHashKey } from '../data-manager/utils/hash';

/**
 * ConversationService
 *
 * 封装对 FileConversationStore 的操作。
 * 默认复用 sessionRegistry 的 conversationStore 实例，
 * 确保 forward 和 web 模式的对话数据在同一个 store 中。
 *
 * 职责：
 * - web 模式对话的 findOrCreate / appendAssistant / updateHash
 * - 所有模式的 listSnapshots / findById / delete（供 REST API 使用）
 *
 * 注意：forward 模式的数据由 sessionRegistry 负责（ingest + appendResponse + syncConversationMirror），
 * ConversationService 不再重复写入 forward 数据。
 */
export class ConversationService {
  private store: FileConversationStore;

  constructor(store?: FileConversationStore) {
    // 如果外部传入 store（如 sessionRegistry 的 conversationStore），直接复用
    // 否则创建独立实例（仅用于测试等场景）
    this.store = store ?? new FileConversationStore();
  }

  /**
   * 根据 HASH_KEY / sessionId 查找已有对话，或新建。
   *
   * 仅用于 web 模式。forward 模式由 sessionRegistry 处理。
   *
   * - 优先用 sessionId 精确匹配
   * - 回退到 hashKey 匹配
   * - 未命中则新建
   */
  findOrCreate(params: {
    sessionId?: string;
    hashKey: string;
    mode: 'web' | 'forward';
    providerKey: string;
    model: string;
    system: string;
    history: Message[];
    tools: Tool[];
    current: Message[];
  }): ConversationRecord {
    const { sessionId, hashKey, mode, providerKey, model, system, history, tools, current } = params;
    const now = Date.now();

    // 1. 优先用 sessionId 精确匹配
    if (sessionId) {
      const bySessionId = this.store.findBySessionId(sessionId);
      if (bySessionId) {
        const currentMsgs = this.toConversationMessages(current, now);
        bySessionId.messages.push(...currentMsgs);
        bySessionId.stats.rounds += 1;
        bySessionId.stats.lastActiveAt = now;
        this.store.save(bySessionId);
        return bySessionId;
      }
    }

    // 2. 回退到 hashKey 匹配
    const existing = this.store.findByLatestHash(hashKey);
    if (existing) {
      const currentMsgs = this.toConversationMessages(current, now);
      existing.messages.push(...currentMsgs);
      existing.stats.rounds += 1;
      existing.stats.lastActiveAt = now;
      this.store.save(existing);
      return existing;
    }

    // 3. 新建记录
    const conversationId = sessionId || uuidv4();
    const messages: ConversationMessage[] = [];

    if (system) {
      messages.push({ role: 'system', content: system, timestamp: now });
    }
    messages.push(...this.toConversationMessages(history, now));
    messages.push(...this.toConversationMessages(current, now));

    const record: ConversationRecord = {
      conversationId,
      mode,
      providerKey,
      model,
      identity: {
        sessionId: sessionId || undefined,
        latestHash: hashKey,
        systemHash: undefined,
        toolsHash: undefined,
      },
      promptState: {
        system,
        tools: tools as unknown[],
      },
      linkage: {
        linked: false,
        webUrls: [],
      },
      messages,
      stats: {
        rounds: 1,
        createdAt: now,
        lastActiveAt: now,
      },
      retention: {
        ttlMs: null,
      },
    };

    this.store.save(record);
    return record;
  }

  /**
   * 追加 assistant 回复消息（仅用于 web 模式）
   */
  appendAssistant(
    conversationId: string,
    msg: {
      content: string | null;
      tool_calls?: unknown[];
    }
  ): void {
    const record = this.store.findByConversationId(conversationId);
    if (!record) return;

    const now = Date.now();
    const assistantMsg: ConversationMessage = {
      role: 'assistant',
      content: msg.content,
      timestamp: now,
    };
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      assistantMsg.tool_calls = msg.tool_calls;
    }

    record.messages.push(assistantMsg);
    record.stats.lastActiveAt = now;
    this.store.save(record);
  }

  /**
   * 更新对话记录的 latestHash
   */
  updateHash(conversationId: string, newHash: string): void {
    const record = this.store.findByConversationId(conversationId);
    if (!record) return;

    record.identity.latestHash = newHash;
    this.store.save(record);
  }

  /**
   * 列出对话快照（所有模式，供 /v1/conversations API 使用）
   */
  listSnapshots(providerKey?: string, mode?: string): ConversationSnapshot[] {
    const snapshots = this.store.listSnapshots(providerKey);
    if (!mode) return snapshots;
    return snapshots.filter((s) => s.mode === mode);
  }

  /**
   * 获取完整对话记录
   */
  findById(conversationId: string): ConversationRecord | null {
    return this.store.findByConversationId(conversationId);
  }

  /**
   * 删除对话记录
   */
  delete(conversationId: string): boolean {
    return this.store.delete(conversationId);
  }

  /**
   * 重新计算含 assistant 后的新 hash
   */
  static computeNewHash(
    system: string,
    history: Message[],
    current: Message[],
    assistantContent: string | null,
    tools: Tool[]
  ): string {
    const assistantMsg: Message = {
      role: 'assistant',
      content: assistantContent ?? '',
    };
    const newHistory = [...history, ...current, assistantMsg];
    return computeHashKey(system, newHistory, tools);
  }

  // ── 私有工具方法 ──

  private toConversationMessages(messages: Message[], timestamp: number): ConversationMessage[] {
    return messages.map((msg) => ({
      role: msg.role as ConversationMessage['role'],
      content: msg.content as unknown,
      tool_calls: Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0
        ? (msg.tool_calls as unknown[])
        : undefined,
      tool_call_id: msg.tool_call_id,
      name: msg.name,
      timestamp,
    }));
  }
}

/**
 * 全局单例 — 初始化时必须调用 initConversationService()
 * 让它复用 sessionRegistry 的 conversationStore
 */
let _conversationService: ConversationService | null = null;

export function initConversationService(store: FileConversationStore): void {
  _conversationService = new ConversationService(store);
}

export function getConversationService(): ConversationService {
  if (!_conversationService) {
    // 兜底：如果未初始化，创建独立实例（不应发生）
    _conversationService = new ConversationService();
  }
  return _conversationService;
}