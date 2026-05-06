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

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function shortHash(input: string, length = 16): string {
  return sha256Hex(input).slice(0, length);
}

function canonicalizeJsonValue(value: any): any {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((v) => canonicalizeJsonValue(v));
  if (typeof value !== 'object') return value;
  const keys = Object.keys(value).sort();
  const out: Record<string, any> = {};
  for (const k of keys) {
    out[k] = canonicalizeJsonValue((value as any)[k]);
  }
  return out;
}

function canonicalJson(value: any): string {
  return JSON.stringify(canonicalizeJsonValue(value));
}

function getToolFunctionName(tool: any): string {
  const name = tool?.function?.name;
  return typeof name === 'string' ? name : '';
}

function computeToolsHash(tools: unknown[]): string {
  if (!Array.isArray(tools) || tools.length === 0) return shortHash('');
  const sorted = [...tools].sort((a: any, b: any) =>
    getToolFunctionName(a).localeCompare(getToolFunctionName(b))
  );
  return shortHash(canonicalJson(sorted));
}

function stringifyForHash(c: unknown): string {
  if (typeof c === 'string') return c;
  if (c == null) return '';
  try {
    return canonicalJson(c);
  } catch {
    return String(c);
  }
}

function extractUserRollingContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0] as any;
    if (first && typeof first === 'object') {
      if (first.type === 'text' && typeof first.text === 'string') return first.text;
      if (typeof first.content === 'string') return first.content;
    }
    return stringifyForHash(first);
  }
  return stringifyForHash(content);
}

function findLastAssistantIndex(messages: RawMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return i;
  }
  return -1;
}

function computeUserRollingHash(messages: RawMessage[], seed = ''): string {
  let rolling = seed || shortHash('');
  for (const m of messages) {
    if (m.role !== 'user') continue;
    const piece = extractUserRollingContent(m.content);
    rolling = shortHash(`${rolling}\n${piece}`);
  }
  return rolling;
}

function computeSystemHash(messages: RawMessage[]): string {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => stringifyForHash(m.content))
    .filter(Boolean)
    .join('\n');
  return shortHash(system);
}

function computeSessionHashes(input: { messages: RawMessage[]; tools: unknown[] }): {
  toolsHash: string;
  systemHash: string;
  userRollingHashBefore: string;
  userRollingHashAfter: string;
  baseHash: string;
  updatedHash: string;
} {
  const toolsHash = computeToolsHash(input.tools);
  const systemHash = computeSystemHash(input.messages);
  const lastAssistantIdx = findLastAssistantIndex(input.messages);
  const beforeAssistant =
    lastAssistantIdx === -1 ? input.messages : input.messages.slice(0, lastAssistantIdx);
  const afterAssistant = lastAssistantIdx === -1 ? [] : input.messages.slice(lastAssistantIdx + 1);
  const userRollingHashBefore = computeUserRollingHash(beforeAssistant);
  const userRollingHashAfter = computeUserRollingHash(afterAssistant, userRollingHashBefore);
  const baseHash = `${systemHash}_${userRollingHashBefore}_${toolsHash}`;
  const updatedHash = `${systemHash}_${userRollingHashAfter}_${toolsHash}`;
  return {
    toolsHash,
    systemHash,
    userRollingHashBefore,
    userRollingHashAfter,
    baseHash,
    updatedHash,
  };
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
  conversationId: string;
  sessionId: string;
  providerKey: string;
  model: string;
  tools: unknown[];
  toolsHash?: string;
  systemHash?: string;
  userRollingHash?: string;
  messages: SessionMessage[];
  rounds: number;
  createdAt: number;
  lastActiveAt: number;
};

export type IngestResult =
  | { action: 'new';    session: Session; newMessages: SessionMessage[] }
  | { action: 'append'; session: Session; newMessages: SessionMessage[]; previousSessionId?: string };

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

  /** 获取内部的 conversationStore 实例（供 ConversationService / API 共用） */
  getConversationStore(): FileConversationStore {
    return this.conversationStore;
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
        const conversationId =
          typeof (sess as any).conversationId === 'string' && (sess as any).conversationId.trim()
            ? (sess as any).conversationId.trim()
            : sess.sessionId;
        const normalized: Session = {
          ...sess,
          conversationId,
          tools: Array.isArray(sess.tools) ? sess.tools : [],
          sessionId: typeof sess.sessionId === 'string' ? sess.sessionId : String(sess.sessionId ?? ''),
        };
        this.sessions.set(conversationId, normalized);
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
      conversationId: record.conversationId,
      sessionId: record.identity.sessionId ?? record.conversationId,
      providerKey: record.providerKey,
      model: record.model,
      tools: record.promptState.tools,
      toolsHash: record.identity.toolsHash,
      systemHash: record.identity.systemHash,
      userRollingHash: (() => {
        const latest = record.identity.latestHash;
        if (typeof latest === 'string' && latest.includes('_')) {
          const parts = latest.split('_');
          return parts.length >= 3 ? parts[1] : undefined;
        }
        return undefined;
      })(),
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
      conversationId: snapshot.conversationId,
      sessionId: record?.identity.sessionId ?? snapshot.conversationId,
      providerKey: snapshot.providerKey,
      model: snapshot.model,
      tools: record?.promptState.tools ?? [],
      toolsHash: record?.identity.toolsHash,
      systemHash: record?.identity.systemHash,
      userRollingHash: (() => {
        const latest = record?.identity.latestHash;
        if (typeof latest === 'string' && latest.includes('_')) {
          const parts = latest.split('_');
          return parts.length >= 3 ? parts[1] : undefined;
        }
        return undefined;
      })(),
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
      const existing = this.sessions.get(session.conversationId);
      if (!existing || existing.lastActiveAt < session.lastActiveAt) {
        this.sessions.set(session.conversationId, session);
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
      conversationId: session.conversationId,
      mode: 'forward',
      providerKey: session.providerKey,
      model: session.model,
      identity: {
        sessionId: session.sessionId,
        latestHash: session.sessionId,
        toolsHash: session.toolsHash,
        systemHash: session.systemHash,
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
    const hashes = computeSessionHashes({ messages: rawMessages, tools });
    const lookupSessionId = headerSessionId ? `hdr:${headerSessionId}` : hashes.baseHash;
    const nextSessionId = headerSessionId ? `hdr:${headerSessionId}` : hashes.updatedHash;

    const existingRecord = this.conversationStore.findBySessionId(lookupSessionId);
    const existing = existingRecord ? this.buildSessionFromConversationRecord(existingRecord) : undefined;

    if (existing) {
      // 命中已有 session：追加新消息
      for (const m of newMessages) {
        existing.messages.push(m);
      }
      existing.lastActiveAt = now;
      existing.providerKey = providerKey;
      existing.model = model;
      existing.tools = tools;
      existing.toolsHash = hashes.toolsHash;
      existing.systemHash = hashes.systemHash;
      existing.userRollingHash = hashes.userRollingHashAfter;
      existing.sessionId = nextSessionId;
      // ✅ 立即持久化（防止数据丢失）
      this.sessions.set(existing.conversationId, existing);
      this.save();
      this.syncConversationMirror(existing);
      return {
        action: 'append',
        session: existing,
        newMessages,
        previousSessionId: headerSessionId ? undefined : lookupSessionId,
      };
    }

    // 新建 session：把历史消息 + 新消息都收入
    const allMessages = [...history, ...newMessages];
    const session: Session = {
      conversationId: headerSessionId ? `hdr:${headerSessionId}` : lookupSessionId,
      sessionId: nextSessionId,
      providerKey,
      model,
      tools,
      toolsHash: hashes.toolsHash,
      systemHash: hashes.systemHash,
      userRollingHash: hashes.userRollingHashAfter,
      messages: allMessages,
      rounds: 0,
      createdAt: now,
      lastActiveAt: now,
    };
    this.sessions.set(session.conversationId, session);
    // ✅ 立即持久化（防止数据丢失）
    this.save();
    this.syncConversationMirror(session);
    console.log(`[SessionRegistry] 新建 session ${session.sessionId.slice(0, 16)} (provider=${providerKey}, model=${model})`);
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
    const record = this.conversationStore.findBySessionId(sessionId);
    if (!record || record.mode !== 'forward') return null;
    const session = this.buildSessionFromConversationRecord(record);

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
    this.sessions.set(session.conversationId, session);
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
    const record =
      this.conversationStore.findBySessionId(sessionId) ??
      this.conversationStore.findByLatestHash(sessionId);
    if (!record || record.mode !== 'forward') return undefined;
    return this.buildSessionFromConversationRecord(record);
  }

  /** 删除单个 session */
  deleteSession(sessionId: string): boolean {
    const record =
      this.conversationStore.findBySessionId(sessionId) ??
      this.conversationStore.findByLatestHash(sessionId);
    if (!record) return false;
    const deleted = this.sessions.delete(record.conversationId);
    if (deleted) {
      this.save();
    }
    this.conversationStore.delete(record.conversationId);
    return true;
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
