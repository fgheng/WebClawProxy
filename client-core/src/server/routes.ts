import { Router, Request, Response } from 'express';
import { WebSocket } from 'ws';
import { AgentSession, AgentSessionOptions, AgentChatResult, type AgentEvent } from './agent-session';
import { FileSessionStore } from './file-session-store';
import { builtInToolDefinitions, builtInToolNames } from '../core/tools/index';

/**
 * REST API 路由
 *
 * 所有 API 都通过 sessionsManager 来管理 AgentSession 实例。
 */
export function createApiRouter(sessionsManager: SessionManager): Router {
  const router = Router();

  // ── Health ──────────────────────────────────────────────
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // ── Chat ──────────────────────────────────────────────
  router.post('/chat', async (req: Request, res: Response) => {
    try {
      const { message, sessionId, model, system, mode, proxyBaseUrl } = req.body;

      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'message is required' });
      }

      console.log(`[AgentService /chat] received: sessionId=${sessionId}, message="${message.slice(0,50)}"`);
      let session = sessionId
        ? sessionsManager.get(sessionId)
        : sessionsManager.getDefault();
      console.log(`[AgentService /chat] session lookup: sessionId=${sessionId} → found=${!!session}${session ? ` (id=${session.getSessionId()})` : ' (null)'}`);

      if (!session) {
        session = sessionsManager.create({
          proxyBaseUrl,
          model,
          system,
          mode,
        });
        console.log(`[AgentService /chat] created new session: id=${session.getSessionId()}`);
      }

      if (model) session.setModel(model);
      if (system) session.setSystem(system);
      if (mode) session.setMode(mode);

      const result = await session.chat(message);
      res.json({
        ...result,
        sessionId: session.getSessionId(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? String(err) });
    }
  });

  // ── Sessions ──────────────────────────────────────────
  router.get('/sessions', (_req: Request, res: Response) => {
    res.json({ sessions: sessionsManager.list() });
  });

  router.post('/sessions/new', async (req: Request, res: Response) => {
    try {
      const { model, system, mode, proxyBaseUrl } = req.body;
      const session = sessionsManager.create({
        proxyBaseUrl,
        model,
        system,
        mode,
      });
      res.json({ sessionId: session.getSessionId() });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? String(err) });
    }
  });

  router.get('/sessions/:id', (req: Request, res: Response) => {
    const session = sessionsManager.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session.getState());
  });

  router.delete('/sessions/:id', (req: Request, res: Response) => {
    const removed = sessionsManager.remove(req.params.id);
    res.json({ ok: removed });
  });

  // ── Tools ──────────────────────────────────────────────
  router.get('/tools', (_req: Request, res: Response) => {
    const tools = builtInToolNames.map((name) => {
      const def = builtInToolDefinitions.find((t) => t.function.name === name);
      return {
        name,
        description: def?.function.description ?? '',
        parameters: def?.function.parameters ?? {},
      };
    });
    res.json({ tools });
  });

  // ── Config ──────────────────────────────────────────────
  router.get('/config', (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string | undefined;
    const session = sessionId
      ? sessionsManager.get(sessionId)
      : sessionsManager.getDefault();

    if (!session) {
      return res.status(404).json({ error: 'No active session' });
    }
    const state = session.getState();
    res.json({
      model: state.model,
      provider: state.provider,
      mode: state.mode,
      systemPrompt: state.systemPrompt,
      sessionId: state.sessionId,
    });
  });

  router.patch('/config', (req: Request, res: Response) => {
    const { sessionId, model, system, mode } = req.body;
    const session = sessionId
      ? sessionsManager.get(sessionId)
      : sessionsManager.getDefault();

    if (!session) {
      return res.status(404).json({ error: 'No active session' });
    }

    if (model) session.setModel(model);
    if (system) session.setSystem(system);
    if (mode) session.setMode(mode);

    res.json({ ok: true, state: session.getState() });
  });

  return router;
}

// ── Session Manager ──────────────────────────────────────

/**
 * 管理 AgentSession 实例的生命周期
 */
export class SessionManager {
  private sessions = new Map<string, AgentSession>();
  private defaultSession: AgentSession | null = null;
  private defaultOptions: AgentSessionOptions = {};
  private sessionStore: FileSessionStore;
  /** 已连接的 WebSocket，用于广播事件 */
  private wsClients: Set<WebSocket> = new Set();
  private initialized = false;

  constructor(defaultOptions?: AgentSessionOptions) {
    this.defaultOptions = defaultOptions ?? {};
    this.sessionStore = new FileSessionStore();
  }

  /** 启动时从 FileSessionStore 加载已有 session 到内存 */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const summaries = await this.sessionStore.listSessions();
    for (const summary of summaries) {
      const data = await this.sessionStore.loadSession(summary.id);
      if (!data) continue;
      // 从文件数据重建 AgentSession
      const session = new AgentSession({
        sessionId: data.id,
        model: data.model,
        mode: data.mode,
        sessionStore: this.sessionStore,
      });
      // 将文件里的历史消息恢复到 client.messages
      if (data.messages && data.messages.length > 0) {
        const history = data.messages.map((m) => {
          const msg: any = { role: m.role, content: m.content ?? '' };
          if (m.toolCalls) msg.tool_calls = m.toolCalls;
          if (m.toolResultOf) { msg.role = 'tool'; msg.tool_call_id = m.toolResultOf; msg.name = m.toolResultOf; }
          return msg;
        }).filter((m: any) => m.role === 'user' || m.role === 'assistant' || m.role === 'system' || m.role === 'tool');
        session.client.importHistory(history);
        session.core.currentSession = data;
      }
      this.sessions.set(session.getSessionId(), session);
      if (!this.defaultSession || summary.updatedAt > (this.defaultSession as any).updatedAt) {
        this.defaultSession = session;
      }
      session.setEventCallback((event) => this.broadcastEvent(event));
    }
  }

  /** 注册 WebSocket 连接（用于广播工具事件等） */
  registerWs(ws: WebSocket): void {
    this.wsClients.add(ws);
    ws.on('close', () => this.wsClients.delete(ws));
  }

  /** 广播事件到所有已连接的 WebSocket */
  broadcastEvent(event: AgentEvent): void {
    const data = JSON.stringify(event);
    for (const ws of this.wsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  create(options?: AgentSessionOptions): AgentSession {
    const merged = { ...this.defaultOptions, ...options };
    const session = new AgentSession(merged);
    this.sessions.set(session.getSessionId(), session);
    if (!this.defaultSession) {
      this.defaultSession = session;
    }
    // 所有 session 的事件都广播到 WebSocket 客户端
    session.setEventCallback((event) => this.broadcastEvent(event));
    return session;
  }

  get(sessionId: string): AgentSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  getDefault(): AgentSession | null {
    return this.defaultSession;
  }

  remove(sessionId: string): boolean {
    if (this.defaultSession?.getSessionId() === sessionId) {
      this.defaultSession = null;
    }
    return this.sessions.delete(sessionId);
  }

  list(): Array<{ sessionId: string; model: string; provider: string }> {
    return Array.from(this.sessions.values()).map((s) => {
      const state = s.getState();
      return {
        sessionId: s.getSessionId(),
        model: state.model,
        provider: state.provider,
      };
    });
  }
}