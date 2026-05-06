/**
 * AgentClient 共享类型定义
 *
 * Desktop 和 TUI 都使用这些接口与 Agent Service 通信。
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