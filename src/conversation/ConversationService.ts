import { v4 as uuidv4 } from 'uuid';
import { FileConversationStore } from './FileConversationStore';
import { ConversationRecord, ConversationMessage, ConversationSnapshot } from './types';
import { Message, Tool } from '../protocol/types';
import { computeHashKey } from '../data-manager/utils/hash';

/**
 * ConversationService
 *
 * 封装对 FileConversationStore 的所有操作，提供：
 * - findOrCreate: 根据 HASH_KEY 查找或新建对话记录
 * - appendAssistant: 追加 assistant 回复
 * - updateHash: 更新 latestHash（含 current+assistant 后重算）
 * - listSnapshots / findById / delete: 查询接口
 */
export class ConversationService {
  private store: FileConversationStore;

  constructor(rootDir?: string) {
    this.store = new FileConversationStore(rootDir);
  }

  /**
   * 根据 HASH_KEY 查找已有对话，或新建。
   *
   * - 命中：追加 current 消息，更新 stats
   * - 未命中：新建 ConversationRecord，写入 system/history/current
   */
  findOrCreate(params: {
    hashKey: string;
    mode: 'web' | 'forward';
    providerKey: string;
    model: string;
    system: string;
    history: Message[];
    tools: Tool[];
    current: Message[];
  }): ConversationRecord {
    const { hashKey, mode, providerKey, model, system, history, tools, current } = params;
    const now = Date.now();

    // 尝试命中已有记录
    const existing = this.store.findByLatestHash(hashKey);
    if (existing) {
      // 追加 current 消息
      const currentMsgs = this.toConversationMessages(current, now);
      existing.messages.push(...currentMsgs);
      existing.stats.rounds += 1;
      existing.stats.lastActiveAt = now;
      this.store.save(existing);
      return existing;
    }

    // 新建记录
    const conversationId = uuidv4();
    const messages: ConversationMessage[] = [];

    // 写入 system（放在 messages 最前，方便阅读；promptState 也保存）
    if (system) {
      messages.push({ role: 'system', content: system, timestamp: now });
    }

    // 写入 history
    messages.push(...this.toConversationMessages(history, now));

    // 写入 current
    messages.push(...this.toConversationMessages(current, now));

    const record: ConversationRecord = {
      conversationId,
      mode,
      providerKey,
      model,
      identity: {
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
   * 追加 assistant 回复消息到指定对话记录
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
   * 更新对话记录的 latestHash（assistant 回复后重算）
   */
  updateHash(conversationId: string, newHash: string): void {
    const record = this.store.findByConversationId(conversationId);
    if (!record) return;

    record.identity.latestHash = newHash;
    this.store.save(record);
  }

  /**
   * 列出对话快照，支持按 provider 和 mode 过滤
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
   * 重新计算并更新 hash（assistant 回复后调用）
   *
   * newHistory = 原 history + current(user) + assistant
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

/** 全局单例 */
export const conversationService = new ConversationService();
