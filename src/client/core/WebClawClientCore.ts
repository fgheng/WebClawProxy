import { ChatMessage } from '../types';
import { parseCommand } from './commands';
import { getClientCommandHelpText } from './help-text';
import {
  createEmptyProviderModelCatalog,
  getDefaultModelForProvider,
  inferProviderFromModel,
  ProviderKey,
} from './provider-models';
import {
  ClientCoreHostActions,
  ClientCoreOptions,
  ClientCoreResult,
  ClientCoreState,
  ClientTransport,
} from './types';

export class WebClawClientCore {
  private readonly client: ClientTransport;
  private readonly catalog;
  private readonly hostActions?: ClientCoreHostActions;
  private provider: ProviderKey;

  constructor(options: ClientCoreOptions) {
    this.client = options.transport;
    this.catalog = options.catalog ?? createEmptyProviderModelCatalog();
    this.hostActions = options.hostActions;
    this.provider = inferProviderFromModel(this.client.getConfig().model, this.catalog);
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
      stream: cfg.stream,
      systemPrompt,
      history,
    };
  }

  async executeInput(input: string): Promise<ClientCoreResult> {
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
      const response = await this.client.sendMessage(trimmed);
      return {
        kind: 'chat',
        userInput: trimmed,
        response,
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
      case 'new':
        this.client.clearHistory();
        return {
          kind: 'command',
          command: command.type,
          lines: [command.type === 'new' ? '已开启新的本地对话上下文' : '历史记录已清空'],
          state: this.getState(),
        };
      case 'reset':
        this.client.clearHistory();
        this.client.setSystem('');
        return {
          kind: 'command',
          command: 'reset',
          lines: ['历史记录和系统提示词已重置'],
          state: this.getState(),
        };
      case 'model':
        this.client.setModel(command.value);
        this.syncProviderWithModel();
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
        this.emitEvent();
        return {
          kind: 'command',
          command: 'provider',
          lines: [`Provider 已切换为 ${provider}，模型已切到 ${nextModel}`],
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
}
