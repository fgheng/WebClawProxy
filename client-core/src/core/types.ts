import { AssistantResponse, ChatMessage, ClientConfig } from '../types';
import { ProviderKey, ProviderModelCatalog } from './provider-models';

export type ClientRouteMode = 'web' | 'forward';

export type ClientSessionMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: unknown[];
  toolResultOf?: string;
  createdAt: number;
};

export type ClientSessionData = {
  id: string;
  title: string;
  provider: ProviderKey;
  model: string;
  mode: ClientRouteMode;
  createdAt: number;
  updatedAt: number;
  messages: ClientSessionMessage[];
};

export type ClientSessionSummary = {
  id: string;
  title: string;
  provider: ProviderKey;
  model: string;
  mode: ClientRouteMode;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
};

export interface ClientSessionStore {
  listSessions(): Promise<ClientSessionSummary[]>;
  loadSession(sessionId: string): Promise<ClientSessionData | null>;
  saveSession(session: ClientSessionData): Promise<void>;
}

export interface ClientTransport {
  sendMessage(userContent: string): Promise<AssistantResponse>;
  /** 发送完整 messages（含 tool results）用于工具循环 */
  sendRequest(messages: ChatMessage[]): Promise<AssistantResponse>;
  clearHistory(): void;
  importHistory(messages: ChatMessage[]): void;
  getHistory(): ChatMessage[];
  getConfig(): Required<ClientConfig>;
  setSessionId?(sessionId: string): void;
  setModel(model: string): void;
  setSystem(system: string): void;
  setStream(enabled: boolean): void;
  setRouteMode?(mode: ClientRouteMode): void;
  getRouteMode?(): ClientRouteMode;
  setTraceEnabled(enabled: boolean): void;
  healthCheck(): Promise<boolean>;
}

export type ClientCoreState = {
  model: string;
  provider: ProviderKey;
  mode: ClientRouteMode;
  sessionId?: string;
  stream: boolean;
  systemPrompt?: string;
  history: ChatMessage[];
};

export type ClientCoreResult =
  | {
      kind: 'chat';
      userInput: string;
      response: AssistantResponse;
      provider: ProviderKey;
      model: string;
    }
  | {
      kind: 'command';
      command: string;
      lines: string[];
      state: ClientCoreState;
      shouldExit?: boolean;
    };

export type ClientCoreEvents = {
  type: 'provider-change' | 'state-change';
  provider?: ProviderKey;
  model?: string;
};

export type ClientCoreHostActions = {
  onEvent?: (event: ClientCoreEvents) => void;
};

export type ClientCoreConfig = ClientConfig;

/**
 * 工具执行器接口 — 由外部注入，负责执行模型返回的 tool_calls。
 * 如果不注入，工具调用不做自动执行，只记录在对话中展示给用户。
 */
export interface ToolExecutor {
  /** 执行指定工具，返回 JSON 字符串结果 */
  execute(toolName: string, args: Record<string, unknown>): Promise<string>;
}

export type ClientCoreOptions = {
  transport: ClientTransport;
  catalog?: ProviderModelCatalog;
  hostActions?: ClientCoreHostActions;
  sessionStore?: ClientSessionStore;
  toolExecutor?: ToolExecutor;
};
