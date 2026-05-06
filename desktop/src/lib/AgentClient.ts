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
  private sessionStorageKey = 'webclaw_agent_session_id';

  constructor(options?: { agentUrl?: string }) {
    const url = options?.agentUrl ?? `http://localhost:${DEFAULT_AGENT_PORT}`;
    this.baseUrl = url;
    this.wsUrl = url.replace(/^http/, 'ws') + '/ws';
    // 从 localStorage 恢复 sessionId，避免组件重建后丢失会话
    try {
      const savedId = localStorage.getItem(this.sessionStorageKey);
      if (savedId) this.sessionId = savedId;
    } catch { /* localStorage 可能不可用 */ }
  }

  private saveSessionId(id: string | null): void {
    this.sessionId = id;
    try {
      if (id) localStorage.setItem(this.sessionStorageKey, id);
      else localStorage.removeItem(this.sessionStorageKey);
    } catch { /* ignore */ }
  }

  // ── REST API ──────────────────────────────────────────

  async chat(message: string, options?: { model?: string; system?: string; mode?: string }): Promise<AgentChatResponse> {
    const url = `${this.baseUrl}/v1/chat`;
    console.log(`[AgentClient] POST ${url} sessionId=${this.sessionId}`);
    const res = await fetch(url, {
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
      console.error(`[AgentClient] HTTP ${res.status}: ${JSON.stringify(err)}`);
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }

    const data = await res.json();
    console.log(`[AgentClient] Response: kind=${data.kind}, sessionId=${data.sessionId}`);
    if (data.sessionId) this.saveSessionId(data.sessionId);
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
    this.saveSessionId(data.sessionId);
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

  /** 验证当前 sessionId 是否还存在于服务端 */
  async validateSession(): Promise<boolean> {
    if (!this.sessionId) return false;
    try {
      const res = await fetch(`${this.baseUrl}/v1/sessions/${this.sessionId}`);
      return res.ok;
    } catch { return false; }
  }

  /** 切换到已有的 session */
  async loadSession(sessionId: string): Promise<AgentConfig | null> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}`);
      if (!res.ok) return null;
      const state = await res.json();
      this.saveSessionId(sessionId);
      return {
        model: state.model,
        provider: state.provider,
        mode: state.mode,
        sessionId,
      };
    } catch { return null; }
  }

  /** 获取当前 session 的历史消息 */
  async getSessionHistory(): Promise<Array<{ role: string; content: string }>> {
    if (!this.sessionId) return [];
    try {
      const res = await fetch(`${this.baseUrl}/v1/sessions/${this.sessionId}`);
      if (!res.ok) return [];
      const state = await res.json();
      return state.history ?? [];
    } catch { return []; }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/health`);
      return res.ok;
    } catch { return false; }
  }

  // ── WebSocket ──────────────────────────────────────────

  connectWebSocket(): void {
    if (this.ws || this.reconnectTimer) return;
    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => { this._connected = true; };
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data));
        if (data.sessionId) this.saveSessionId(data.sessionId);
        this.eventCallback?.(data);
      } catch { /* ignore */ }
    };
    this.ws.onclose = () => {
      this._connected = false;
      this.ws = null;
      // 15秒后重连（不要太频繁）
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connectWebSocket();
      }, 15000);
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