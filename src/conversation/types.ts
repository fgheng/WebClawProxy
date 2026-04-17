export type ConversationMode = 'web' | 'forward';

export type ConversationMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
  timestamp: number;
};

export type ConversationRecord = {
  conversationId: string;
  mode: ConversationMode;
  providerKey: string;
  model: string;
  identity: {
    sessionId?: string;
    latestHash?: string;
    hashChain?: string[];
    toolsHash?: string;
    systemHash?: string;
    firstUserHash?: string;
  };
  promptState: {
    system: string;
    tools: unknown[];
  };
  linkage: {
    linked: boolean;
    webUrls: string[];
  };
  messages: ConversationMessage[];
  stats: {
    rounds: number;
    createdAt: number;
    lastActiveAt: number;
  };
  retention: {
    ttlMs: number | null;
  };
};

export type ConversationSnapshot = {
  conversationId: string;
  mode: ConversationMode;
  providerKey: string;
  model: string;
  rounds: number;
  createdAt: number;
  lastActiveAt: number;
  linked: boolean;
  webUrls: string[];
  messageCount: number;
  lastMessage: ConversationMessage | null;
};
