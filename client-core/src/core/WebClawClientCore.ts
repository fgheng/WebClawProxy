import { AssistantResponse, ChatMessage } from '../types';
import { parseCommand } from './commands';
import { getClientCommandHelpText } from './help-text';
import {
  createEmptyProviderModelCatalog,
  getDefaultModelForProvider,
  inferProviderFromModel,
  ProviderKey,
} from './provider-models';
import {
  ClientRouteMode,
  ClientSessionData,
  ClientSessionMessage,
  ClientSessionStore,
  ClientCoreHostActions,
  ClientCoreOptions,
  ClientCoreResult,
  ClientCoreState,
  ClientTransport,
  ToolExecutor,
} from './types';
import { builtInToolDefinitions, builtInToolExecutor, builtInToolNames } from './tools';

export class WebClawClientCore {
  private readonly client: ClientTransport;
  private readonly catalog;
  private readonly hostActions?: ClientCoreHostActions;
  private readonly sessionStore?: ClientSessionStore;
  private readonly toolExecutor: ToolExecutor;
  private readonly mergedTools: unknown[];
  private readonly autoLoadLatestSession: boolean;
  private provider: ProviderKey;
  private mode: ClientRouteMode = 'web';
  private currentSession: ClientSessionData | null = null;
  private _toolLoopRunning = false;

  constructor(options: ClientCoreOptions) {
    this.client = options.transport;
    this.catalog = options.catalog ?? createEmptyProviderModelCatalog();
    this.hostActions = options.hostActions;
    this.sessionStore = options.sessionStore;
    this.autoLoadLatestSession = options.autoLoadLatestSession ?? true;

    // 合并内置工具和外部注入的工具定义
    const extraTools = options.extraTools ?? [];
    this.mergedTools = [...builtInToolDefinitions, ...extraTools];

    // 合并内置工具执行器和外部注入的执行器
    const extraExecutor = options.toolExecutor;
    this.toolExecutor = extraExecutor
      ? createMergedExecutor(builtInToolExecutor, extraExecutor)
      : builtInToolExecutor;

    // 把工具定义注入到 Transport 的 config 中
    const currentTools = this.client.getConfig().tools ?? [];
    if (currentTools.length === 0) {
      this.client.setTools?.(this.mergedTools);
    }

    this.provider = inferProviderFromModel(this.client.getConfig().model, this.catalog);
    this.mode = this.client.getRouteMode?.() ?? 'web';
  }

  /** 是否正在执行工具循环 */
  get toolLoopRunning(): boolean {
    return this._toolLoopRunning;
  }

  getTransport(): ClientTransport {
    return this.client;
  }

  getState(): ClientCoreState {
    const cfg = this.client.getConfig();
    const history = this.client.getHistory();
    const systemPrompt = history.find((item) => item.role === 'system')?.content;
    return {
      model: cfg.model,
      provider: this.provider,
      mode: this.mode,
      sessionId: this.currentSession?.id,
      stream: cfg.stream,
      systemPrompt,
      history,
    };
  }

  async executeInput(input: string): Promise<ClientCoreResult> {
    await this.ensureSessionInitialized();
    const trimmed = input.trim();
    if (!trimmed) {
      return {
        kind: 'command',
        command: 'noop',
        lines: [],
        state: this.getState(),
      };
    }

    if (!trimmed.startsWith('/')) {
      this.syncProviderWithModel();
      this.emitEvent();
      this.appendSessionMessage({
        role: 'user',
        content: trimmed,
      });
      await this.persistCurrentSession();
      if (this.currentSession?.id) {
        this.client.setSessionId?.(this.currentSession.id);
      }
      const response = await this.client.sendMessage(trimmed);
      this.appendSessionMessage({
        role: 'assistant',
        content: response.content ?? '',
        toolCalls: response.tool_calls,
      });
      await this.persistCurrentSession();

      // ── 工具循环 ──────────────────────────────────────────────
      // 如果有 tool_calls，自动执行工具并将结果发回模型
      let finalResponse = response;
      if (response.tool_calls.length > 0) {
        this._toolLoopRunning = true;
        this.emitEvent();
        try {
          finalResponse = await this.runToolLoop(response);
        } finally {
          this._toolLoopRunning = false;
          this.emitEvent();
        }
      }

      return {
        kind: 'chat',
        userInput: trimmed,
        response: finalResponse,
        provider: this.provider,
        model: this.client.getConfig().model,
      };
    }

    const command = parseCommand(trimmed);
    if (!command) {
      return {
        kind: 'command',
        command: 'invalid',
        lines: [`未知命令或参数不完整: ${trimmed}`],
        state: this.getState(),
      };
    }

    switch (command.type) {
      case 'help':
        return {
          kind: 'command',
          command: 'help',
          lines: [getClientCommandHelpText()],
          state: this.getState(),
        };
      case 'clear':
        this.client.clearHistory();
        if (this.currentSession) {
          this.currentSession.messages = [];
          this.currentSession.updatedAt = Date.now();
          await this.persistCurrentSession();
        }
        return {
          kind: 'command',
          command: command.type,
          lines: ['历史记录已清空'],
          state: this.getState(),
        };
      case 'new':
        await this.createNewSession();
        return {
          kind: 'command',
          command: command.type,
          lines: [`已开启新会话：${this.currentSession?.id}`],
          state: this.getState(),
        };
      case 'reset':
        this.client.clearHistory();
        this.client.setSystem('');
        if (this.currentSession) {
          this.currentSession.messages = [];
          this.currentSession.updatedAt = Date.now();
          await this.persistCurrentSession();
        }
        return {
          kind: 'command',
          command: 'reset',
          lines: ['历史记录和系统提示词已重置'],
          state: this.getState(),
        };
      case 'model':
        this.client.setModel(command.value);
        this.syncProviderWithModel();
        if (this.currentSession) {
          this.currentSession.model = command.value;
          this.currentSession.provider = this.provider;
          this.currentSession.updatedAt = Date.now();
          await this.persistCurrentSession();
        }
        this.emitEvent();
        return {
          kind: 'command',
          command: 'model',
          lines: [`模型已切换为 ${command.value}`],
          state: this.getState(),
        };
      case 'provider': {
        const provider = command.value as ProviderKey;
        const nextModel = getDefaultModelForProvider(provider, this.catalog);
        this.provider = provider;
        this.client.setModel(nextModel);
        if (this.currentSession) {
          this.currentSession.provider = provider;
          this.currentSession.model = nextModel;
          this.currentSession.updatedAt = Date.now();
          await this.persistCurrentSession();
        }
        this.emitEvent();
        return {
          kind: 'command',
          command: 'provider',
          lines: [`Provider 已切换为 ${provider}，模型已切到 ${nextModel}`],
          state: this.getState(),
        };
      }
      case 'mode': {
        this.mode = command.value;
        this.client.setRouteMode?.(command.value);
        if (this.currentSession) {
          this.currentSession.mode = command.value;
          this.currentSession.updatedAt = Date.now();
          await this.persistCurrentSession();
        }
        return {
          kind: 'command',
          command: 'mode',
          lines: [`模式已切换为 ${command.value}`],
          state: this.getState(),
        };
      }
      case 'sessions': {
        const sessions = await this.sessionStore?.listSessions();
        if (!sessions || sessions.length === 0) {
          return {
            kind: 'command',
            command: 'sessions',
            lines: ['暂无历史会话'],
            state: this.getState(),
          };
        }
        const lines = sessions.map((session, index) => {
          const marker = this.currentSession?.id === session.id ? '*' : ' ';
          return `${marker}${index + 1}. ${session.id} | ${session.provider}/${session.model} | ${session.mode} | ${session.messageCount} msg`;
        });
        return {
          kind: 'command',
          command: 'sessions',
          lines,
          state: this.getState(),
        };
      }
      case 'session': {
        const loaded = await this.sessionStore?.loadSession(command.value);
        if (!loaded) {
          return {
            kind: 'command',
            command: 'session',
            lines: [`未找到会话: ${command.value}`],
            state: this.getState(),
          };
        }
        this.currentSession = loaded;
        this.client.setSessionId?.(loaded.id);
        this.provider = loaded.provider;
        this.mode = loaded.mode;
        this.client.setModel(loaded.model);
        this.client.setRouteMode?.(loaded.mode);
        this.client.clearHistory();
        this.client.importHistory(this.toTransportHistory(loaded.messages));
        this.emitEvent();
        return {
          kind: 'command',
          command: 'session',
          lines: [`已加载会话 ${loaded.id}（${loaded.messages.length} 条）`],
          state: this.getState(),
        };
      }
      case 'system':
        this.client.setSystem(command.value);
        return {
          kind: 'command',
          command: 'system',
          lines: ['系统提示词已更新'],
          state: this.getState(),
        };
      case 'history':
        return {
          kind: 'command',
          command: 'history',
          lines: this.formatHistory(this.client.getHistory()),
          state: this.getState(),
        };
      case 'config':
        return {
          kind: 'command',
          command: 'config',
          lines: [JSON.stringify(this.client.getConfig(), null, 2)],
          state: this.getState(),
        };
      case 'trace':
        return {
          kind: 'command',
          command: 'trace',
          lines: [`trace=${this.client.getConfig().traceEnabled ? 'on' : 'off'}`],
          state: this.getState(),
        };
      case 'stream': {
        const current = this.client.getConfig().stream;
        const next = command.enabled ?? !current;
        this.client.setStream(next);
        return {
          kind: 'command',
          command: 'stream',
          lines: [`stream=${next ? 'on' : 'off'}`],
          state: this.getState(),
        };
      }
      case 'quit':
      case 'exit':
        return {
          kind: 'command',
          command: command.type,
          lines: ['bye'],
          state: this.getState(),
          shouldExit: true,
        };
    }
  }

  private syncProviderWithModel(): void {
    this.provider = inferProviderFromModel(this.client.getConfig().model, this.catalog);
  }

  /**
   * 工具循环：执行 tool_calls → 将结果发回模型 → 重复直到无 tool_calls 或达到最大轮次
   */
  private async runToolLoop(initialResponse: AssistantResponse): Promise<AssistantResponse> {
    const MAX_TOOL_ROUNDS = 10;
    const loopMessages: ChatMessage[] = [...this.client.getHistory()];

    // 首次 response 已经有 assistant(tool_calls) 在 history 里了
    let currentToolCalls = initialResponse.tool_calls;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // 执行每个 tool_call
      for (const tc of currentToolCalls) {
        const toolCall = tc as { id?: string; function?: { name?: string; arguments?: string } };
        const toolName = toolCall.function?.name ?? '';
        const toolArgsRaw = toolCall.function?.arguments ?? '{}';

        let args: Record<string, unknown>;
        try {
          args = JSON.parse(toolArgsRaw);
        } catch {
          args = {};
        }

        // 通知前端/宿主：正在执行某个工具
        this.hostActions?.onEvent?.({
          type: 'tool-executing',
          toolName,
          toolArgs: args,
        });

        let result: string;
        try {
          result = await this.toolExecutor!.execute(toolName, args);
        } catch (err) {
          result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
        }

        // 把 tool result 添加到 loopMessages 和 session
        const toolResultMsg: ChatMessage = {
          role: 'tool',
          content: result,
          tool_call_id: toolCall.id ?? '',
          name: toolName,
        };
        loopMessages.push(toolResultMsg);

        this.appendSessionMessage({
          role: 'tool',
          content: result,
          toolResultOf: toolCall.id ?? '',
        });
        await this.persistCurrentSession();
        this.emitEvent();
      }

      // 发送带 tool results 的消息给模型
      const nextResponse = await this.client.sendRequest(loopMessages);

      // 记录新的 assistant 响应
      this.appendSessionMessage({
        role: 'assistant',
        content: nextResponse.content ?? '',
        toolCalls: nextResponse.tool_calls,
      });
      await this.persistCurrentSession();
      this.emitEvent();

      // 把 assistant 消息也加入 loopMessages
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: nextResponse.content ?? '',
        tool_calls: nextResponse.tool_calls.length > 0 ? nextResponse.tool_calls : undefined,
      };
      loopMessages.push(assistantMsg);

      // 如果没有更多 tool_calls，循环结束
      if (nextResponse.tool_calls.length === 0) {
        return nextResponse;
      }

      // 继续循环
      currentToolCalls = nextResponse.tool_calls;
    }

    // 达到最大轮次，返回最后一条响应
    return {
      content: initialResponse.content,
      tool_calls: [],
      finish_reason: 'max_tool_rounds',
      usage: initialResponse.usage,
    };
  }

  private emitEvent(): void {
    this.hostActions?.onEvent?.({
      type: 'provider-change',
      provider: this.provider,
      model: this.client.getConfig().model,
    });
  }

  private formatHistory(history: ChatMessage[]): string[] {
    if (history.length === 0) {
      return ['暂无历史记录'];
    }

    return history.map((item, index) => {
      const preview = item.content.replace(/\s+/g, ' ').slice(0, 120);
      return `${index + 1}. [${item.role}] ${preview}`;
    });
  }

  private async ensureSessionInitialized(): Promise<void> {
    if (this.currentSession) return;

    // 如果 autoLoadLatestSession 为 false，直接创建新空 session
    // （Agent Service 模式：session 由 SessionManager 管理，不从文件加载旧数据）
    if (!this.autoLoadLatestSession) {
      await this.createNewSession();
      return;
    }

    const sessions = await this.sessionStore?.listSessions();
    if (sessions && sessions.length > 0) {
      const latest = await this.sessionStore?.loadSession(sessions[0].id);
      if (latest) {
        const preferredModel = this.client.getConfig().model;
        const preferredProvider = inferProviderFromModel(preferredModel, this.catalog);
        const preferredMode = this.client.getRouteMode?.() ?? this.mode;

        this.currentSession = latest;
        this.client.setSessionId?.(latest.id);
        this.provider = preferredProvider;
        this.mode = preferredMode;
        this.client.setModel(preferredModel);
        this.client.setRouteMode?.(preferredMode);

        // Host (GUI/TUI) selected provider/model/mode should take precedence on first init.
        this.currentSession.provider = preferredProvider;
        this.currentSession.model = preferredModel;
        this.currentSession.mode = preferredMode;
        this.currentSession.updatedAt = Date.now();
        this.client.clearHistory();
        this.client.importHistory(this.toTransportHistory(latest.messages));
        await this.persistCurrentSession();
        return;
      }
    }
    await this.createNewSession();
  }

  private async createNewSession(): Promise<void> {
    this.client.clearHistory();
    const model = this.client.getConfig().model;
    const now = Date.now();
    const session: ClientSessionData = {
      id: this.buildSessionId(),
      title: `chat-${new Date(now).toISOString().slice(0, 19).replace('T', ' ')}`,
      provider: this.provider,
      model,
      mode: this.mode,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    this.currentSession = session;
    this.client.setSessionId?.(session.id);
    await this.persistCurrentSession();
  }

  /** 外部设置 session 数据（用于 Agent Service 启动时从文件恢复） */
  setSessionData(data: ClientSessionData): void {
    this.currentSession = data;
  }

  private appendSessionMessage(input: {
    role: ClientSessionMessage['role'];
    content: string;
    toolCalls?: unknown[];
    toolResultOf?: string;
  }): void {
    if (!this.currentSession) return;
    const message: ClientSessionMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: input.role,
      content: input.content,
      createdAt: Date.now(),
      toolCalls: input.toolCalls,
      toolResultOf: input.toolResultOf,
    };
    this.currentSession.messages.push(message);
    this.currentSession.updatedAt = Date.now();
  }

  private async persistCurrentSession(): Promise<void> {
    if (!this.currentSession || !this.sessionStore) return;
    await this.sessionStore.saveSession(this.currentSession);
  }

  private toTransportHistory(messages: ClientSessionMessage[]): ChatMessage[] {
    return messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => {
        const next: ChatMessage = {
          role: message.role as 'user' | 'assistant',
          content: message.content,
        };
        if (Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
          next.tool_calls = message.toolCalls;
        }
        return next;
      });
  }

  private buildSessionId(): string {
    const now = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    return `session-${now}-${rand}`;
  }
}

/** 合并多个 ToolExecutor：先尝试 extraExecutor，再 fallback 到 baseExecutor */
function createMergedExecutor(baseExecutor: ToolExecutor, extraExecutor: ToolExecutor): ToolExecutor {
  return {
    async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
      // 如果是内置工具名，用内置执行器
      if (builtInToolNames.includes(toolName)) {
        return baseExecutor.execute(toolName, args);
      }
      // 否则尝试额外执行器
      return extraExecutor.execute(toolName, args);
    },
  };
}
