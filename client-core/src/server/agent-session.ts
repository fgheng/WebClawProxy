import { WebClawClientCore } from '../core/WebClawClientCore';
import { WebClawClient } from '../WebClawClient';
import { builtInToolExecutor, builtInToolDefinitions, builtInToolNames } from '../core/tools/index';
import { FileSessionStore } from './file-session-store';
import { ProviderModelCatalog, createEmptyProviderModelCatalog } from '../core/provider-models';
import { inferProviderFromModel } from '../core/provider-models';
import type { ProviderKey } from '../core/provider-models';
import type { ClientCoreResult, ClientCoreState, ClientSessionData } from '../core/types';
import type { ChatMessage, AssistantResponse } from '../types';
import type * as http from 'http';

/**
 * AgentSession — 服务端包装的 WebClaw Agent 会话
 *
 * 每个 WebSocket 连接或 REST 调用可能涉及一个 AgentSession。
 * AgentSession 内部持有 WebClawClientCore 实例，负责：
 * - 聊天（sendMessage → tool loop）
 * - 会话管理
 * - 状态查询
 * - 事件推送（通过回调函数）
 */
export class AgentSession {
  private core: WebClawClientCore;
  private client: WebClawClient;
  private sessionId: string;
  private eventCallback?: (event: AgentEvent) => void;

  constructor(options: AgentSessionOptions) {
    const proxyBaseUrl = options.proxyBaseUrl ?? 'http://localhost:3000';

    // 创建 WebClawClient（直接与 WebClawProxy 通信）
    this.client = new WebClawClient({
      baseUrl: proxyBaseUrl,
      model: options.model ?? 'gpt-4o',
      system: options.system ?? '',
      sessionId: options.sessionId ?? this.generateSessionId(),
      routeMode: options.mode ?? 'forward',
      stream: false,
      tools: [...builtInToolDefinitions, ...options.extraTools ?? []],
      timeoutMs: 180000,
    });

    this.sessionId = this.client.getConfig().sessionId;

    const catalog = options.catalog ?? createEmptyProviderModelCatalog();

    this.core = new WebClawClientCore({
      transport: this.client,
      catalog,
      sessionStore: options.sessionStore ?? new FileSessionStore(),
      autoLoadLatestSession: false, // Agent Service 不自动加载旧 session 数据
      toolExecutor: options.toolExecutor ?? builtInToolExecutor,
      hostActions: {
        onEvent: (event) => {
          // 将 core 内部事件转发给外部回调
          this.eventCallback?.(convertCoreEvent(event));
        },
      },
    });
  }

  /** 设置事件回调（用于 WebSocket 推送等） */
  setEventCallback(cb: (event: AgentEvent) => void): void {
    this.eventCallback = cb;
  }

  /** 获取历史消息数量 */
  getHistoryLength(): number {
    return this.client.getHistory().length;
  }

  /** 发消息给模型（含 tool loop） */
  async chat(message: string): Promise<AgentChatResult> {
    const result = await this.core.executeInput(message);

    if (result.kind === 'chat') {
      return {
        kind: 'chat',
        content: result.response.content ?? '',
        toolCalls: result.response.tool_calls ?? [],
        finishReason: result.response.finish_reason ?? '',
        model: result.model ?? this.client.getConfig().model,
        sessionId: this.sessionId,
        provider: result.provider,
      };
    }

    // command result（/new, /help 等）
    return {
      kind: 'command',
      command: result.command,
      lines: result.lines,
      sessionId: this.sessionId,
    };
  }

  /** 新建会话 */
  async newSession(options?: { model?: string; system?: string }): Promise<string> {
    const newId = this.generateSessionId();
    if (options?.model) {
      this.client.setModel(options.model);
    }
    if (options?.system) {
      this.client.setSystem(options.system);
    }
    this.client.setSessionId?.(newId);
    this.sessionId = newId;
    this.core = new WebClawClientCore({
      transport: this.client,
      catalog: createEmptyProviderModelCatalog(),
      sessionStore: new FileSessionStore(),
      autoLoadLatestSession: false,
      toolExecutor: builtInToolExecutor,
      hostActions: {
        onEvent: (event) => {
          this.eventCallback?.(convertCoreEvent(event));
        },
      },
    });
    // 新会话需要清空 client 的历史消息
    this.client.clearHistory();
    return newId;
  }

  /** 获取当前状态 */
  getState(): ClientCoreState {
    return this.core.getState();
  }

  /** 获取可用工具列表 */
  getTools(): Array<{ name: string; description: string }> {
    return builtInToolNames.map((name) => {
      const def = builtInToolDefinitions.find((t) => t.function.name === name);
      return { name, description: def?.function.description ?? '' };
    });
  }

  /** 设置模型 */
  setModel(model: string): void {
    this.client.setModel(model);
  }

  /** 设置系统提示词 */
  setSystem(system: string): void {
    this.client.setSystem(system);
  }

  /** 设置 route mode */
  setMode(mode: 'web' | 'forward'): void {
    this.client.setRouteMode?.(mode);
  }

  /** 从文件数据恢复 session（用于 Agent Service 启动时恢复） */
  restoreFromData(data: ClientSessionData): void {
    if (data.messages && data.messages.length > 0) {
      const history = data.messages
        .map((m) => {
          const msg: any = { role: m.role, content: m.content ?? '' };
          if (m.toolCalls) msg.tool_calls = m.toolCalls;
          if (m.toolResultOf) { msg.role = 'tool'; msg.tool_call_id = m.toolResultOf; msg.name = m.toolResultOf; }
          return msg;
        })
        .filter((m: any) => m.role === 'user' || m.role === 'assistant' || m.role === 'system' || m.role === 'tool');
      this.client.importHistory(history);
      this.core.setSessionData(data);
    }
    (this as any)._updatedAt = data.updatedAt;
  }

  /** 获取 session ID */
  getSessionId(): string {
    return this.sessionId;
  }

  private generateSessionId(): string {
    const now = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    return `session-${now}-${rand}`;
  }
}

// ── 类型定义 ──────────────────────────────────────────

export interface AgentSessionOptions {
  proxyBaseUrl?: string;
  model?: string;
  system?: string;
  mode?: 'web' | 'forward';
  sessionId?: string;
  catalog?: ProviderModelCatalog;
  sessionStore?: any;
  toolExecutor?: any;
  extraTools?: unknown[];
}

export interface AgentChatResult {
  kind: 'chat' | 'command';
  content?: string;
  toolCalls?: unknown[];
  finishReason?: string;
  model?: string;
  sessionId: string;
  provider?: ProviderKey;
  command?: string;
  lines?: string[];
}

/** Agent Service 推送给前端的事件 */
export interface AgentEvent {
  type: string;
  data: Record<string, unknown>;
  sessionId?: string;
  timestamp: number;
}

/** 将 core 内部事件转为 AgentEvent */
function convertCoreEvent(event: any): AgentEvent {
  const timestamp = Date.now();
  if (event.type === 'provider-change') {
    return { type: 'provider_change', data: { provider: event.provider }, timestamp };
  }
  if (event.type === 'tool-executing') {
    return { type: 'tool_executing', data: { toolName: event.toolName, toolArgs: event.toolArgs }, timestamp };
  }
  if (event.type === 'tool-loop-start') {
    return { type: 'tool_loop_start', data: {}, timestamp };
  }
  if (event.type === 'tool-loop-end') {
    return { type: 'tool_loop_end', data: {}, timestamp };
  }
  // generic
  return { type: event.type ?? 'unknown', data: event, timestamp };
}