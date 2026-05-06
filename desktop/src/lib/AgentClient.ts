/**
 * AgentClient (浏览器版) — Desktop 前端与 Agent Service 的通信层
 *
 * 通过 HTTP REST API + WebSocket 与 client-core Agent Service 交互。
 * Desktop 不 import client-core 内部代码，只通过此客户端通信。
 */

import type {
  AgentChatResponse,
  AgentEvent,
  AgentConfig,
  AgentToolInfo,
  AgentEventCallback,
} from '../../../client-core/src/shared/agent-client-types';

export type {
  AgentChatResponse,
  AgentEvent,
  AgentConfig,
  AgentToolInfo,
  AgentEventCallback,
} from '../../../client-core/src/shared/agent-client-types';

const DEFAULT_AGENT_PORT = 8100;

export class AgentClient {
  private baseUrl: string;
  private wsUrl: string;
  private ws: WebSocket | null = null;
  private eventCallback: AgentEventCallback | null = null;
  private sessionId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;

  constructor(options?: { agentUrl?: string }) {
    const url = options?.agentUrl ?? `http://localhost:${DEFAULT_AGENT_PORT}`;
    this.baseUrl = url;
    this.wsUrl = url.replace(/^http/, 'ws') + '/ws';
  }

  // ── REST API ──────────────────────────────────────────

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
    if (data.sessionId) this.sessionId = data.sessionId;
    return data;
  }

  async newSession(options?: { model?: string; system?: string; mode?: string }): Promise<string> {
    const res = await fetch(`${this.baseUrl}/v1/sessions/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: options?.model, system: options?.system, mode: options?.mode }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }

    const data = await res.json();
    this.sessionId = data.sessionId;
    return data.sessionId;
  }

  async getConfig(): Promise<AgentConfig> {
    const res = await fetch(`${this.baseUrl}/v1/config?sessionId=${this.sessionId ?? ''}`);
    return res.json();
  }

  async updateConfig(config: Partial<AgentConfig>): Promise<AgentConfig> {
    const res = await fetch(`${this.baseUrl}/v1/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: this.sessionId, ...config }),
    });
    return res.json();
  }

  async getTools(): Promise<AgentToolInfo[]> {
    const res = await fetch(`${this.baseUrl}/v1/tools`);
    const data = await res.json();
    return data.tools ?? [];
  }

  async getSessions(): Promise<Array<{ sessionId: string; model: string; provider: string }>> {
    const res = await fetch(`${this.baseUrl}/v1/sessions`);
    const data = await res.json();
    return data.sessions ?? [];
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/health`);
      return res.ok;
    } catch { return false; }
  }

  // ── WebSocket ──────────────────────────────────────────

  connectWebSocket(): void {
    if (this.ws) return;
    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => { this._connected = true; };
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data));
        if (data.sessionId) this.sessionId = data.sessionId;
        this.eventCallback?.(data);
      } catch { /* ignore */ }
    };
    this.ws.onclose = () => {
      this._connected = false;
      this.ws = null;
      this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 5000);
    };
    this.ws.onerror = () => { this._connected = false; };
  }

  disconnectWebSocket(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) { this.ws.close(); this.ws = null; }
    this._connected = false;
  }

  get connected(): boolean { return this._connected; }
  setEventCallback(cb: AgentEventCallback): void { this.eventCallback = cb; }
  getSessionId(): string | null { return this.sessionId; }
}