/**
 * AgentClient (Node.js 版) — TUI 与 Agent Service 的通信层
 *
 * 使用 Node.js http 模块 + ws 库与 Agent Service 通信。
 * TUI 不 import client-core 内部代码，只通过此客户端通信。
 */

import * as http from 'http';
import WebSocket from 'ws';
import type {
  AgentChatResponse,
  AgentEvent,
  AgentConfig,
  AgentToolInfo,
  AgentEventCallback,
} from '../../client-core/src/shared/agent-client-types';

export type {
  AgentChatResponse,
  AgentEvent,
  AgentConfig,
  AgentToolInfo,
  AgentEventCallback,
} from '../../client-core/src/shared/agent-client-types';

const DEFAULT_AGENT_PORT = 8100;

export class AgentClient {
  private baseUrl: string;
  private wsUrl: string;
  private ws: WebSocket | null = null;
  private eventCallback: AgentEventCallback | null = null;
  private sessionId: string | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private _connected = false;

  constructor(options?: { agentUrl?: string }) {
    const url = options?.agentUrl ?? `http://localhost:${DEFAULT_AGENT_PORT}`;
    this.baseUrl = url;
    this.wsUrl = url.replace(/^http/, 'ws') + '/ws';
  }

  // ── REST API ──────────────────────────────────────────

  private async request(path: string, method: string = 'GET', body?: unknown): Promise<any> {
    const url = new URL(path, this.baseUrl);
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    return new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            try {
              const err = JSON.parse(data);
              reject(new Error(err.error ?? `HTTP ${res.statusCode}`));
            } catch {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            }
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      });

      req.on('error', (err) => reject(err));

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  async chat(message: string, options?: { model?: string; system?: string; mode?: string }): Promise<AgentChatResponse> {
    const data = await this.request('/v1/chat', 'POST', {
      message,
      sessionId: this.sessionId,
      model: options?.model,
      system: options?.system,
      mode: options?.mode,
    });
    if (data.sessionId) this.sessionId = data.sessionId;
    return data;
  }

  async newSession(options?: { model?: string; system?: string; mode?: string }): Promise<string> {
    const data = await this.request('/v1/sessions/new', 'POST', {
      model: options?.model,
      system: options?.system,
      mode: options?.mode,
    });
    this.sessionId = data.sessionId;
    return data.sessionId;
  }

  async getConfig(): Promise<AgentConfig> {
    return this.request(`/v1/config?sessionId=${this.sessionId ?? ''}`);
  }

  async updateConfig(config: Partial<AgentConfig>): Promise<AgentConfig> {
    return this.request('/v1/config', 'PATCH', { sessionId: this.sessionId, ...config });
  }

  async getTools(): Promise<AgentToolInfo[]> {
    const data = await this.request('/v1/tools');
    return data.tools ?? [];
  }

  async getSessions(): Promise<Array<{ sessionId: string; model: string; provider: string }>> {
    const data = await this.request('/v1/sessions');
    return data.sessions ?? [];
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.request('/v1/health');
      return true;
    } catch { return false; }
  }

  // ── WebSocket ──────────────────────────────────────────

  connectWebSocket(): void {
    if (this.ws) return;
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => { this._connected = true; });
    this.ws.on('message', (raw) => {
      try {
        const data = JSON.parse(String(raw));
        if (data.sessionId) this.sessionId = data.sessionId;
        this.eventCallback?.(data);
      } catch { /* ignore */ }
    });
    this.ws.on('close', () => {
      this._connected = false;
      this.ws = null;
      this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 5000);
    });
    this.ws.on('error', () => { this._connected = false; });
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