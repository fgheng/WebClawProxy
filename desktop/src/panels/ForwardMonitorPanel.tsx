import { useEffect, useRef, useState } from 'react';

// ── 类型 ─────────────────────────────────────────────────────────────────────

type MonitorMessage = {
  role: string;
  content: unknown;
  tool_calls?: unknown[];
  timestamp: number;
};

type ServerSession = {
  conversationId: string;
  providerKey: string;
  model: string;
  rounds: number;
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
  messages: MonitorMessage[];
};

type SseEvent =
  | { type: 'session-snapshot'; sessions: Array<Omit<ServerSession, 'messages'> & { messageCount: number; lastMessage: MonitorMessage | null }> }
  | { type: 'session-new'; sessionId: string; providerKey: string; model: string; newMessages: MonitorMessage[]; timestamp: number }
  | { type: 'session-append'; sessionId: string; newMessages: MonitorMessage[]; previousSessionId?: string; timestamp: number }
  | { type: 'session-response'; sessionId: string; content: string | null; tool_calls?: unknown[]; finish_reason?: string; status?: number; timestamp: number };

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function contentToString(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function sessionTitle(session: ServerSession): string {
  return `${session.providerKey} · ${session.model}`;
}

// ── 组件 ──────────────────────────────────────────────────────────────────────

type ForwardMonitorPanelProps = {
  apiBaseUrl: string;
  providerFilter?: string; // 可选，按 provider 过滤
};

export function ForwardMonitorPanel({ apiBaseUrl, providerFilter }: ForwardMonitorPanelProps) {
  const [sessions, setSessions] = useState<Map<string, ServerSession>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const baseUrl = apiBaseUrl.replace(/\/$/, '');

  // ── 初始拉取存量 conversations ──────────────────────────────────────────────
  useEffect(() => {
    if (!baseUrl) return;

    const fetchConversations = async () => {
      try {
        const providerParam = providerFilter ? `&provider=${encodeURIComponent(providerFilter)}` : '';
        const res = await fetch(`${baseUrl}/v1/conversations?mode=forward${providerParam}`);
        if (!res.ok) return;
        const data = await res.json() as { conversations: Array<Omit<ServerSession, 'messages'> & { messageCount: number; lastMessage: MonitorMessage | null }> };
        setSessions((prev) => {
          const next = new Map(prev);
          for (const snap of data.conversations ?? []) {
            if (!next.has(snap.conversationId)) {
              next.set(snap.conversationId, {
                ...snap,
                messages: snap.lastMessage ? [snap.lastMessage] : [],
              });
            }
          }
          return next;
        });
      } catch {
        // 服务未启动时静默忽略
      }
    };

    void fetchConversations();
  }, [baseUrl, providerFilter]);

  // ── SSE 连接 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!baseUrl) return;

    const sseUrl = `${baseUrl}/v1/forward-monitor/events`;
    let es: EventSource;
    let closed = false;

    const connect = () => {
      es = new EventSource(sseUrl);
      sseRef.current = es;

      es.onopen = () => {
        if (!closed) setConnected(true);
      };

      es.onerror = () => {
        if (!closed) {
          setConnected(false);
          // 3 秒后重连
          setTimeout(() => {
            if (!closed) connect();
          }, 3000);
        }
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as SseEvent;
          handleSseEvent(data);
        } catch {
          // ignore parse errors
        }
      };
    };

    connect();

    return () => {
      closed = true;
      setConnected(false);
      es?.close();
      sseRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl]);

  // ── SSE 事件处理 ────────────────────────────────────────────────────────────
  function handleSseEvent(event: SseEvent) {
    const now = Date.now();

    if (event.type === 'session-snapshot') {
      setSessions((prev) => {
        const next = new Map(prev);
        for (const snap of event.sessions) {
          if (!next.has(snap.conversationId)) {
            next.set(snap.conversationId, {
              ...snap,
              messages: snap.lastMessage ? [snap.lastMessage] : [],
            });
          }
        }
        return next;
      });
      return;
    }

    if (event.type === 'session-new') {
      const { sessionId, providerKey, model, newMessages } = event;
      setSessions((prev) => {
        const next = new Map(prev);
        const existing = next.get(sessionId);
        if (existing) {
          next.set(sessionId, {
            ...existing,
            messages: [...existing.messages, ...newMessages],
            lastActiveAt: now,
            messageCount: existing.messageCount + newMessages.length,
          });
        } else {
          next.set(sessionId, {
            conversationId: sessionId,
            providerKey,
            model,
            rounds: 0,
            createdAt: now,
            lastActiveAt: now,
            messageCount: newMessages.length,
            messages: newMessages,
          });
        }
        return next;
      });
      // 自动选中第一条新 session
      setSelectedId((prev) => prev ?? sessionId);
      return;
    }

    if (event.type === 'session-append') {
      const { sessionId, newMessages } = event;
      setSessions((prev) => {
        const next = new Map(prev);
        const existing = next.get(sessionId);
        if (existing) {
          next.set(sessionId, {
            ...existing,
            messages: [...existing.messages, ...newMessages],
            lastActiveAt: now,
            messageCount: existing.messageCount + newMessages.length,
          });
        }
        return next;
      });
      return;
    }

    if (event.type === 'session-response') {
      const { sessionId, content, tool_calls } = event;
      const assistantMsg: MonitorMessage = {
        role: 'assistant',
        content,
        tool_calls: Array.isArray(tool_calls) && tool_calls.length > 0 ? tool_calls : undefined,
        timestamp: now,
      };
      setSessions((prev) => {
        const next = new Map(prev);
        const existing = next.get(sessionId);
        if (existing) {
          next.set(sessionId, {
            ...existing,
            messages: [...existing.messages, assistantMsg],
            rounds: existing.rounds + 1,
            lastActiveAt: now,
            messageCount: existing.messageCount + 1,
          });
        }
        return next;
      });
      return;
    }
  }

  // ── 点击某条 session，拉取完整 messages ────────────────────────────────────
  const handleSelectSession = async (conversationId: string) => {
    setSelectedId(conversationId);
    // 如果已有 messages 且数量和服务端相近，不重复拉取
    const existing = sessions.get(conversationId);
    if (existing && existing.messages.length >= (existing.messageCount ?? 0)) return;

    try {
      const res = await fetch(`${baseUrl}/v1/conversations/${conversationId}/messages`);
      if (!res.ok) return;
      const data = await res.json() as { messages: MonitorMessage[] };
      setSessions((prev) => {
        const next = new Map(prev);
        const current = next.get(conversationId);
        if (current) {
          next.set(conversationId, {
            ...current,
            messages: data.messages,
            messageCount: data.messages.length,
          });
        }
        return next;
      });
    } catch {
      // ignore
    }
  };

  // ── 自动滚到消息底部 ────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedId, sessions]);

  // ── 渲染 ────────────────────────────────────────────────────────────────────
  const sessionList = Array.from(sessions.values())
    .filter((s) => !providerFilter || s.providerKey === providerFilter)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);

  const selectedSession = selectedId ? sessions.get(selectedId) : null;

  return (
    <div className="fmp-root">
      {/* 左侧：session 列表 */}
      <div className="fmp-sidebar">
        <div className="fmp-sidebar-header">
          <span className="fmp-title mono">Forward 对话</span>
          <span className={`fmp-status-dot ${connected ? 'connected' : 'disconnected'}`} title={connected ? '实时连接' : '未连接'} />
        </div>
        <div className="fmp-session-list">
          {sessionList.length === 0 ? (
            <div className="fmp-empty mono">暂无对话记录</div>
          ) : (
            sessionList.map((s) => (
              <div
                key={s.conversationId}
                className={`fmp-session-item${selectedId === s.conversationId ? ' selected' : ''}`}
                onClick={() => void handleSelectSession(s.conversationId)}
              >
                <div className="fmp-session-title mono">{sessionTitle(s)}</div>
                <div className="fmp-session-meta mono">
                  {s.rounds} 轮 · {s.messageCount} 条 · {formatTime(s.lastActiveAt)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 右侧：消息流 */}
      <div className="fmp-messages">
        {!selectedSession ? (
          <div className="fmp-no-select mono">← 选择一条对话查看消息</div>
        ) : (
          <>
            <div className="fmp-messages-header mono">
              {sessionTitle(selectedSession)} · {selectedSession.rounds} 轮对话
            </div>
            <div className="fmp-messages-body">
              {selectedSession.messages.map((msg, idx) => {
                const role = msg.role as string;
                const text = contentToString(msg.content);
                if (role === 'system') {
                  return (
                    <div key={idx} className="fmp-msg fmp-msg-system">
                      <span className="fmp-msg-role mono">system</span>
                      <span className="fmp-msg-text mono">{text}</span>
                    </div>
                  );
                }
                if (role === 'user') {
                  return (
                    <div key={idx} className="fmp-msg fmp-msg-user">
                      <div className="fmp-msg-bubble user">
                        <div className="fmp-msg-text">{text}</div>
                        <div className="fmp-msg-time mono">{formatTime(msg.timestamp)}</div>
                      </div>
                    </div>
                  );
                }
                if (role === 'assistant') {
                  return (
                    <div key={idx} className="fmp-msg fmp-msg-assistant">
                      <div className="fmp-msg-bubble assistant">
                        <div className="fmp-msg-text">{text || (msg.tool_calls ? '[tool_calls]' : '（空响应）')}</div>
                        <div className="fmp-msg-time mono">{formatTime(msg.timestamp)}</div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={idx} className="fmp-msg fmp-msg-tool">
                    <span className="fmp-msg-role mono">{role}</span>
                    <span className="fmp-msg-text mono">{text}</span>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
