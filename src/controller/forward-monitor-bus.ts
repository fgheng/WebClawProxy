import { EventEmitter } from 'events';
import { Response } from 'express';
import type { SessionMessage, Session } from './session-registry';

// ── 原有事件类型（保留，向后兼容）────────────────────────────────────────────

export type ForwardMonitorMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
};

export type ForwardMonitorRequestEvent = {
  type: 'request';
  traceId: string;
  providerKey: string;
  model: string;
  mode: 'web' | 'forward';
  messages: ForwardMonitorMessage[];
  timestamp: number;
};

export type ForwardMonitorResponseEvent = {
  type: 'response';
  traceId: string;
  providerKey: string;
  model: string;
  mode: 'web' | 'forward';
  content: string | null;
  tool_calls?: unknown[];
  finish_reason?: string;
  status: number;
  durationMs: number;
  timestamp: number;
};

// ── Session 事件类型 ──────────────────────────────────────────────────────────

/** 新 session 创建（没有命中已有 session） */
export type SessionNewEvent = {
  type: 'session-new';
  sessionId: string;
  providerKey: string;
  model: string;
  tools: unknown[];
  newMessages: SessionMessage[];
  timestamp: number;
};

/** 已有 session 追加新消息（本轮新增的 user/tool 等消息） */
export type SessionAppendEvent = {
  type: 'session-append';
  sessionId: string;
  previousSessionId?: string;
  providerKey: string;
  newMessages: SessionMessage[];
  timestamp: number;
};

/** assistant 回复到达 */
export type SessionResponseEvent = {
  type: 'session-response';
  sessionId: string;
  providerKey: string;
  content: string | null;
  tool_calls?: unknown[];
  finish_reason?: string;
  status: number;
  durationMs: number;
  timestamp: number;
};

/** 初始化快照：新客户端连接时推送全量 session 摘要 */
export type SessionSnapshotEvent = {
  type: 'session-snapshot';
  sessions: Array<
    Omit<Session, 'messages'> & {
      messageCount: number;
      lastMessage: SessionMessage | null;
    }
  >;
  timestamp: number;
};

export type ForwardMonitorEvent =
  | ForwardMonitorRequestEvent
  | ForwardMonitorResponseEvent
  | SessionNewEvent
  | SessionAppendEvent
  | SessionResponseEvent
  | SessionSnapshotEvent;

// ── ForwardMonitorBus ─────────────────────────────────────────────────────────

class ForwardMonitorBus extends EventEmitter {
  private clients: Set<Response> = new Set();

  addClient(res: Response): () => void {
    this.clients.add(res);
    return () => {
      this.clients.delete(res);
    };
  }

  emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === 'monitor') {
      const payload = args[0] as ForwardMonitorEvent;
      const data = `data: ${JSON.stringify(payload)}\n\n`;
      for (const client of this.clients) {
        try {
          client.write(data);
        } catch {
          this.clients.delete(client);
        }
      }
    }
    return super.emit(event, ...args);
  }

  publish(event: ForwardMonitorEvent): void {
    this.emit('monitor', event);
  }
}

export const forwardMonitorBus = new ForwardMonitorBus();
