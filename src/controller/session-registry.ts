/**
 * SessionRegistry
 *
 * 通过三段 hash（tools / system / user rolling）识别同一对话会话，
 * 将多次独立 HTTP 请求聚合为连续的 Session。
 *
 * 持久化：启动时从 JSON 文件加载，运行时定期保存，优雅退出时保存。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { FileConversationStore } from '../conversation/FileConversationStore';
import type { ConversationMessage, ConversationRecord, ConversationSnapshot } from '../conversation/types';
import { loadAppConfig } from '../config/app-config';

// ── Hash 工具 ─────────────────────────────────────────────────────────────────

/** djb2 哈希，返回 8 位十六进制字符串 */
function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (((h << 5) + h) ^ str.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export type SessionMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
  timestamp: number;
};

export type Session = {
  sessionId: string;
  providerKey: string;
  model: string;
  tools: unknown[];
  messages: SessionMessage[];
  rounds: number;
  createdAt: number;
  lastActiveAt: number;
};

export type IngestResult =
  | { action: 'new';    session: Session; newMessages: SessionMessage[] }
  | { action: 'append'; session: Session; newMessages: SessionMessage[] };

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

type RawMessage = {
  role: string;
  content?: unknown;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
};

function normalizeContent(c: unknown): unknown | null {
  if (c == null) return null;
  return c;
}

function stringifyContentForHash(c: unknown): string {
  if (typeof c === 'string') return c;
  if (c == null) return '';
  try {
    return JSON.stringify(c);
  } catch {
    return String(c);
  }
}

function toSessionMessage(m: RawMessage, ts: number): SessionMessage {
  return {
    role: m.role as SessionMessage['role'],
    content: normalizeContent(m.content),
    tool_calls: m.tool_calls,
    tool_call_id: m.tool_call_id,
    name: m.name,
    timestamp: ts,
  };
}

/**
 * 从后向前找到最后一个 role=assistant 的位置，
 * 返回 [历史消息, 新消息] 的切割结果。
 *
 * 历史 = messages[0 .. lastAssistantIdx]（含 assistant）
 * 新消息 = messages[lastAssistantIdx+1 ..]
 *
 * 若没有 assistant 消息，历史为空，全部为新消息。
 */
function splitMessages(
  messages: RawMessage[],
  now: number,
): { history: SessionMessage[]; newMessages: SessionMessage[] } {
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      lastAssistantIdx = i;
      break;
    }
  }

  if (lastAssistantIdx === -1) {
    return {
      history: [],
      newMessages: messages.map((m) => toSessionMessage(m, now)),
    };
  }

  return {
    history: messages.slice(0, lastAssistantIdx + 1).map((m) => toSessionMessage(m, now)),
    newMessages: messages.slice(lastAssistantIdx + 1).map((m) => toSessionMessage(m, now)),
  };
}

type FingerprintInput = {
  authorization?: string;
  userAgent?: string;
  ip?: string;
};

let runtimeSessionSecret = '';

function getSessionSecret(): string {
  const env = String(
    process.env.WEBCLAW_SESSION_FINGERPRINT_SECRET ??
    process.env.WEBCLAW_SERVER_SECRET ??
    ''
  ).trim();
  if (env) return env;
  if (!runtimeSessionSecret) {
    runtimeSessionSecret = crypto.randomBytes(32).toString('hex');
  }
  return runtimeSessionSecret;
}

function hmacHex(secret: string, input: string): string {
  return crypto.createHmac('sha256', secret).update(input).digest('hex');
}

function getClientFingerprintHex(input?: FingerprintInput): string {
  const secret = getSessionSecret();
  const authorization = typeof input?.authorization === 'string' ? input.authorization.trim() : '';
  if (authorization) {
    return hmacHex(secret, `auth:${authorization}`);
  }
  const ip = typeof input?.ip === 'string' ? input.ip.trim() : '';
  const ua = typeof input?.userAgent === 'string' ? input.userAgent.trim() : '';
  if (ip || ua) {
    return hmacHex(secret, `ipua:${ip}|${ua}`);
  }
  return hmacHex(secret, 'anon');
}

function shortHex(hex: string, length: number): string {
  const normalized = typeof hex === 'string' ? hex : '';
  if (!/^[0-9a-f]+$/i.test(normalized)) return '0'.repeat(length);
  return normalized.slice(0, length).padEnd(length, '0');
}

function computeStableConversationKey(
  providerKey: string,
  model: string,
  tools: unknown[],
  allMessages: RawMessage[],
): { fullKey: string; shortKey: string; hasHistory: boolean; lastUserHash: string } {
  const toolsHash = djb2(tools.length > 0 ? JSON.stringify(tools) : '');
  const systemContents = allMessages
    .filter((m) => m.role === 'system')
    .map((m) => stringifyContentForHash(m.content))
    .join('\n');
  const systemHash = djb2(systemContents);
  const firstUser = allMessages.find((m) => m.role === 'user');
  const firstUserHash = djb2(stringifyContentForHash(firstUser?.content));
  const lastUser = [...allMessages].reverse().find((m) => m.role === 'user');
  const lastUserHash = djb2(stringifyContentForHash(lastUser?.content));
  const providerHash = djb2(providerKey);
  const modelHash = djb2(model);
  const hasHistory =
    allMessages.some((m) => m.role === 'assistant') ||
    allMessages.filter((m) => m.role === 'user').length > 1;
  return {
    fullKey: `${providerHash}:${modelHash}:${toolsHash}:${systemHash}:${firstUserHash}`,
    shortKey: `${providerHash}:${modelHash}:${toolsHash}:${systemHash}`,
    hasHistory,
    lastUserHash,
  };
}

// ── SessionRegistry ───────────────────────────────────────────────────────────

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 分钟不活跃则清理
const PERSIST_INTERVAL_MS = 60 * 1000; // 每 1 分钟自动保存一次

export class SessionRegistry {
  /** sessionId → Session */
  private sessions = new Map<string, Session>();
  private recentSessionByKey = new Map<string, string>();
  /** 统一会话仓库（当前阶段仅做双写） */
  private readonly conversationStore: FileConversationStore;
  private readonly persistFilePath: string;
  /** 自动清理定时器 */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  /** 自动保存定时器 */
  private persistTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const config = loadAppConfig();
    const dataRootDir = typeof config?.data?.root_dir === 'string' ? config.data.root_dir : '.data';
    const dataRootAbs = path.isAbsolute(dataRootDir) ? dataRootDir : path.resolve(process.cwd(), dataRootDir);

    this.persistFilePath = path.join(dataRootAbs, 'sessions.json');
    this.conversationStore = new FileConversationStore(path.join(dataRootAbs, 'conversations'));

    // 启动时加载持久化数据
    this.load();
    this.hydrateFromConversationStore();
    for (const session of this.sessions.values()) {
      this.syncConversationMirror(session);
    }

    // 每 5 分钟清理一次过期 session
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);

    // 每 1 分钟自动保存一次
    this.persistTimer = setInterval(() => this.save(), PERSIST_INTERVAL_MS);

    // 进程退出时保存数据
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
  }

  private gracefulShutdown(signal: string): void {
    console.log(`[SessionRegistry] 接收到 ${signal}，保存数据并退出...`);
    this.save();
    process.exit(0);
  }

  /** 从文件加载持久化数据 */
  private load(): void {
    try {
      if (!fs.existsSync(this.persistFilePath)) {
        console.log('[SessionRegistry] 持久化文件不存在，跳过加载');
        return;
      }

      const raw = fs.readFileSync(this.persistFilePath, 'utf-8');
      const data = JSON.parse(raw) as { sessions: Session[] };

      let loaded = 0;
      const now = Date.now();
      for (const sess of data.sessions ?? []) {
        // 过滤掉已过期的 session
        if (now - sess.lastActiveAt > SESSION_TTL_MS) continue;
        this.sessions.set(sess.sessionId, sess);
        loaded++;
      }

      console.log(`[SessionRegistry] 从持久化文件加载 ${loaded} 个 session`);
    } catch (error) {
      console.error('[SessionRegistry] 加载持久化文件失败:', error);
    }
  }

  /** 保存数据到文件 */
  private save(): void {
    try {
      const dir = path.dirname(this.persistFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        savedAt: Date.now(),
        sessions: Array.from(this.sessions.values()),
      };

      fs.writeFileSync(this.persistFilePath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`[SessionRegistry] 已保存 ${this.sessions.size} 个 session 到持久化文件`);
    } catch (error) {
      console.error('[SessionRegistry] 保存持久化文件失败:', error);
    }
  }

  private toSessionMessages(messages: ConversationMessage[]): SessionMessage[] {
    return messages.map((message) => ({
      role: message.role,
      content: message.content,
      tool_calls: message.tool_calls,
      tool_call_id: message.tool_call_id,
      name: message.name,
      timestamp: message.timestamp,
    }));
  }

  private buildSessionFromConversationRecord(record: ConversationRecord): Session {
    return {
      sessionId: record.identity.sessionId ?? record.conversationId,
      providerKey: record.providerKey,
      model: record.model,
      tools: record.promptState.tools,
      messages: this.toSessionMessages(record.messages),
      rounds: record.stats.rounds,
      createdAt: record.stats.createdAt,
      lastActiveAt: record.stats.lastActiveAt,
    };
  }

  private toSnapshot(
    snapshot: ConversationSnapshot
  ): Omit<Session, 'messages'> & { lastMessage: SessionMessage | null; messageCount: number } {
    const record = this.conversationStore.findByConversationId(snapshot.conversationId);
    return {
      sessionId: snapshot.conversationId,
      providerKey: snapshot.providerKey,
      model: snapshot.model,
      tools: record?.promptState.tools ?? [],
      rounds: snapshot.rounds,
      createdAt: snapshot.createdAt,
      lastActiveAt: snapshot.lastActiveAt,
      messageCount: snapshot.messageCount,
      lastMessage: snapshot.lastMessage
        ? {
            role: snapshot.lastMessage.role,
            content: snapshot.lastMessage.content,
            tool_calls: snapshot.lastMessage.tool_calls,
            tool_call_id: snapshot.lastMessage.tool_call_id,
            name: snapshot.lastMessage.name,
            timestamp: snapshot.lastMessage.timestamp,
          }
        : null,
    };
  }

  private listForwardConversationRecords(providerKey?: string): ConversationRecord[] {
    return this.conversationStore
      .listByProvider(providerKey)
      .filter((record) => record.mode === 'forward');
  }

  private hydrateFromConversationStore(): void {
    let hydrated = 0;
    for (const record of this.listForwardConversationRecords()) {
      const session = this.buildSessionFromConversationRecord(record);
      const existing = this.sessions.get(session.sessionId);
      if (!existing || existing.lastActiveAt < session.lastActiveAt) {
        this.sessions.set(session.sessionId, session);
        hydrated++;
      }
    }

    if (hydrated > 0) {
      console.log(`[SessionRegistry] 从 ConversationStore 回灌 ${hydrated} 个 forward session`);
    }
  }

  private extractSystemPrompt(messages: SessionMessage[]): string {
    return messages
      .filter((message) => message.role === 'system')
      .map((message) => {
        if (typeof message.content === 'string') return message.content;
        if (message.content == null) return '';
        try {
          return JSON.stringify(message.content);
        } catch {
          return String(message.content);
        }
      })
      .filter(Boolean)
      .join('\n');
  }

  private toConversationMessages(messages: SessionMessage[]): ConversationMessage[] {
    return messages.map((message) => ({
      role: message.role,
      content: message.content,
      tool_calls: message.tool_calls,
      tool_call_id: message.tool_call_id,
      name: message.name,
      timestamp: message.timestamp,
    }));
  }

  private buildConversationRecord(session: Session): ConversationRecord {
    return {
      conversationId: session.sessionId,
      mode: 'forward',
      providerKey: session.providerKey,
      model: session.model,
      identity: {
        sessionId: session.sessionId,
      },
      promptState: {
        system: this.extractSystemPrompt(session.messages),
        tools: session.tools,
      },
      linkage: {
        linked: false,
        webUrls: [],
      },
      messages: this.toConversationMessages(session.messages),
      stats: {
        rounds: session.rounds,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
      },
      retention: {
        ttlMs: SESSION_TTL_MS,
      },
    };
  }

  private syncConversationMirror(session: Session): void {
    this.conversationStore.save(this.buildConversationRecord(session));
  }

  /**
   * 处理一次新的 request：计算 sessionId，命中则 append，否则新建。
   */
  ingest(
    providerKey: string,
    model: string,
    requestBody: Record<string, unknown>,
    options?: { sessionHeader?: string; clientFingerprint?: FingerprintInput },
  ): IngestResult {
    const now = Date.now();
    const rawMessages = Array.isArray(requestBody.messages)
      ? (requestBody.messages as RawMessage[])
      : [];
    const tools = Array.isArray(requestBody.tools) ? requestBody.tools : [];

    const { history, newMessages } = splitMessages(rawMessages, now);
    const headerSessionId = typeof options?.sessionHeader === 'string' ? options.sessionHeader.trim() : '';
    const clientFpShort = shortHex(getClientFingerprintHex(options?.clientFingerprint), 16);
    const conv = computeStableConversationKey(providerKey, model, tools, rawMessages);
    const sessionId = (() => {
      if (headerSessionId) return `hdr:${headerSessionId}`;
      if (!conv.hasHistory) {
        const key = `fp:${clientFpShort}:${conv.shortKey}`;
        const existing = this.recentSessionByKey.get(key);
        if (existing) {
          const sess = this.sessions.get(existing);
          if (sess && now - sess.lastActiveAt < 2 * 60 * 1000) {
            return existing;
          }
          this.recentSessionByKey.delete(key);
        }
        const fresh = `fp:${clientFpShort}:${conv.shortKey}:${conv.lastUserHash}`;
        this.recentSessionByKey.set(key, fresh);
        return fresh;
      }
      return `fp:${clientFpShort}:${conv.fullKey}`;
    })();

    const existing = this.sessions.get(sessionId);

    if (existing) {
      // 命中已有 session：追加新消息
      for (const m of newMessages) {
        existing.messages.push(m);
      }
      existing.lastActiveAt = now;
      // ✅ 立即持久化（防止数据丢失）
      this.save();
      this.syncConversationMirror(existing);
      return { action: 'append', session: existing, newMessages };
    }

    // 新建 session：把历史消息 + 新消息都收入
    const allMessages = [...history, ...newMessages];
    const session: Session = {
      sessionId,
      providerKey,
      model,
      tools,
      messages: allMessages,
      rounds: 0,
      createdAt: now,
      lastActiveAt: now,
    };
    this.sessions.set(sessionId, session);
    if (!headerSessionId) {
      const key = `fp:${clientFpShort}:${conv.shortKey}`;
      this.recentSessionByKey.set(key, sessionId);
    }
    // ✅ 立即持久化（防止数据丢失）
    this.save();
    this.syncConversationMirror(session);
    console.log(`[SessionRegistry] 新建 session ${sessionId.slice(0, 16)} (provider=${providerKey}, model=${model})`);
    return { action: 'new', session, newMessages: allMessages };
  }

  /**
   * assistant 回复到达后，把 assistant 消息追加到 session 并增加 rounds 计数。
   */
  appendResponse(
    sessionId: string,
    content: unknown | null,
    toolCalls?: unknown[],
    finishReason?: string,
  ): Session | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const now = Date.now();
    const assistantMsg: SessionMessage = {
      role: 'assistant',
      content,
      tool_calls: toolCalls,
      timestamp: now,
    };
    session.messages.push(assistantMsg);
    session.rounds += 1;
    session.lastActiveAt = now;
    void finishReason; // 暂不存储，可按需扩展
    // ✅ 立即持久化（防止数据丢失）
    this.save();
    this.syncConversationMirror(session);
    console.log(`[SessionRegistry] session ${sessionId.slice(0, 16)} rounds=${session.rounds}`);
    return session;
  }

  /** 获取所有 session，可选按 provider 过滤 */
  getSessions(providerKey?: string): Session[] {
    return this.listForwardConversationRecords(providerKey).map((record) =>
      this.buildSessionFromConversationRecord(record)
    );
  }

  /** 获取单个 session */
  getSession(sessionId: string): Session | undefined {
    const record = this.conversationStore.findBySessionId(sessionId);
    if (!record || record.mode !== 'forward') return undefined;
    return this.buildSessionFromConversationRecord(record);
  }

  /** 删除单个 session */
  deleteSession(sessionId: string): boolean {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      this.save(); // 立即保存
      this.conversationStore.delete(sessionId);
    }
    return deleted;
  }

  /** 获取所有 provider 名称（去重） */
  getProviders(): string[] {
    const set = new Set<string>();
    for (const s of this.listForwardConversationRecords()) set.add(s.providerKey);
    return Array.from(set);
  }

  /** 获取 session 摘要（不含完整消息体，供快照用） */
  getSnapshot(): Array<Omit<Session, 'messages'> & { lastMessage: SessionMessage | null; messageCount: number }> {
    return this.conversationStore
      .listSnapshots()
      .filter((snapshot) => snapshot.mode === 'forward')
      .map((snapshot) => this.toSnapshot(snapshot));
  }

  /** 清理超过 TTL 的 session */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActiveAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
        cleaned++;
      }
    }
    for (const [key, sessionId] of this.recentSessionByKey.entries()) {
      const sess = this.sessions.get(sessionId);
      if (!sess || now - sess.lastActiveAt > 2 * 60 * 1000) {
        this.recentSessionByKey.delete(key);
      }
    }
    if (cleaned > 0) {
      console.log(`[SessionRegistry] 清理了 ${cleaned} 个过期 session`);
      this.save();
    }
    const cleanedMirror = this.conversationStore.cleanupExpired(now);
    if (cleanedMirror > 0) {
      console.log(`[SessionRegistry] ConversationStore 清理了 ${cleanedMirror} 个过期镜像`);
    }
  }

  /** 销毁（测试用） */
  destroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.persistTimer) clearInterval(this.persistTimer);
    this.save(); // 最后保存一次
  }
}

export const sessionRegistry = new SessionRegistry();
