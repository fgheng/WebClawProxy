/**
 * AgentClient — 前端与 Agent Service 的通信层
 *
 * 通过 HTTP REST API + WebSocket 与 client-core Agent Service 交互。
 * Desktop/TUI 只 import 此文件，不 import client-core 内部代码。
 */

export interface AgentChatResponse {
  kind: 'chat' | 'command';
  content?: string;
  toolCalls?: unknown[];
  finishReason?: string;
  model?: string;
  sessionId: string;
  provider?: string;
  command?: string;
  lines?: string[];
}

export interface AgentEvent {
  type: string;
  data: Record<string, unknown>;
  sessionId?: string;
  timestamp: number;
}

export interface AgentConfig {
  model?: string;
  provider?: string;
  mode?: 'web' | 'forward';
  systemPrompt?: string;
  sessionId?: string;
}

export interface AgentToolInfo {
  name: string;
  description: string;
  parameters: unknown;
}

export type AgentEventCallback = (event: AgentEvent) => void;

const DEFAULT_AGENT_PORT = 8100;

export class AgentClient {
  private baseUrl: string;
  private wsUrl: string;
  private ws: WebSocket | null = null;
  private eventCallback: AgentEventCallback | null = null;
  private sessionId: string | null = null;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private _connected = false;

  constructor(options?: { agentUrl?: string }) {
    const url = options?.agentUrl ?? `http://localhost:${DEFAULT_AGENT_PORT}`;
    this.baseUrl = url;
    this.wsUrl = url.replace(/^http/, 'ws') + '/ws';
  }

  // ── REST API ──────────────────────────────────────────

  /** 发消息给模型（含 tool loop） */
  async chat(message: string, options?: { model?: string; system?: string; mode?: string }): Promise<AgentChatResponse> {
    const res = await fetch(`${this.baseUrl}/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        sessionId: this.sessionId,
        model: options?.model,
        system: options?.system,
        mode: options?.mode,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data.sessionId) {
      this.sessionId = data.sessionId;
    }
    return data;
  }

  /** 新建会话 */
  async newSession(options?: { model?: string; system?: string; mode?: string }): Promise<string> {
    const res = await fetch(`${this.baseUrl}/v1/sessions/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options?.model,
        system: options?.system,
        mode: options?.mode,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }

    const data = await res.json();
    this.sessionId = data.sessionId;
    return data.sessionId;
  }

  /** 获取当前配置 */
  async getConfig(): Promise<AgentConfig> {
    const res = await fetch(`${this.baseUrl}/v1/config?sessionId=${this.sessionId ?? ''}`);
    return res.json();
  }

  /** 更新配置 */
  async updateConfig(config: Partial<AgentConfig>): Promise<AgentConfig> {
    const res = await fetch(`${this.baseUrl}/v1/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: this.sessionId, ...config }),
    });
    return res.json();
  }

  /** 获取可用工具列表 */
  async getTools(): Promise<AgentToolInfo[]> {
    const res = await fetch(`${this.baseUrl}/v1/tools`);
    const data = await res.json();
    return data.tools ?? [];
  }

  /** 获取会话列表 */
  async getSessions(): Promise<Array<{ sessionId: string; model: string; provider: string }>> {
    const res = await fetch(`${this.baseUrl}/v1/sessions`);
    const data = await res.json();
    return data.sessions ?? [];
  }

  /** 健康检查 */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── WebSocket ──────────────────────────────────────────

  /** 连接 WebSocket（用于实时接收事件） */
  connectWebSocket(): void {
    if (this.ws) return;

    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      this._connected = true;
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data));
        if (data.sessionId) {
          this.sessionId = data.sessionId;
        }
        this.eventCallback?.(data);
      } catch { /* ignore parse errors */ }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.ws = null;
      // 自动重连（5秒后）
      this.reconnectTimer = setTimeout(() => {
        this.connectWebSocket();
      }, 5000);
    };

    this.ws.onerror = () => {
      this._connected = false;
    };
  }

  /** 断开 WebSocket */
  disconnectWebSocket(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }

  /** 是否 WebSocket 已连接 */
  get connected(): boolean {
    return this._connected;
  }

  /** 设置事件回调 */
  setEventCallback(cb: AgentEventCallback): void {
    this.eventCallback = cb;
  }

  /** 获取当前 session ID */
  getSessionId(): string | null {
    return this.sessionId;
  }
}