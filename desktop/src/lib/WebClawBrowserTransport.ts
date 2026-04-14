import type {
  AssistantResponse,
  ChatMessage,
  ClientConfig,
  OpenAIRequestBody,
  OpenAIResponseBody,
} from '../../../src/client/types';
import type { ClientTransport } from '../../../src/client/core/types';

export class WebClawBrowserTransport implements ClientTransport {
  private config: Required<ClientConfig>;
  private messages: ChatMessage[] = [];
  private requestSeq = 0;

  constructor(config: ClientConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      model: config.model,
      stream: config.stream ?? false,
      system: config.system ?? '',
      tools: config.tools ?? [],
      timeoutMs: config.timeoutMs ?? 180000,
      sessionId: config.sessionId ?? this.buildDefaultSessionId(),
      traceEnabled: config.traceEnabled ?? true,
      tracePreviewChars: config.tracePreviewChars ?? 180,
    };
  }

  setSystem(system: string): void {
    this.config.system = system;
    this.clearHistory();
  }

  setModel(model: string): void {
    this.config.model = model;
    this.clearHistory();
  }

  setStream(enabled: boolean): void {
    this.config.stream = enabled;
  }

  setTraceEnabled(enabled: boolean): void {
    this.config.traceEnabled = enabled;
  }

  clearHistory(): void {
    this.messages = [];
  }

  getHistory(): ChatMessage[] {
    return [...this.messages];
  }

  getConfig(): Required<ClientConfig> {
    return { ...this.config };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.baseUrl}/health`);
      const data = (await res.json()) as { status?: string };
      return data.status === 'ok';
    } catch {
      return false;
    }
  }

  async sendMessage(userContent: string): Promise<AssistantResponse> {
    this.messages.push({ role: 'user', content: userContent });
    const traceId = this.buildTraceId();

    const requestMessages: ChatMessage[] = [];
    if (this.config.system) {
      requestMessages.push({ role: 'system', content: this.config.system });
    }
    requestMessages.push(...this.messages);

    const body: OpenAIRequestBody = {
      model: this.config.model,
      messages: requestMessages,
      tools: this.config.tools,
      stream: this.config.stream,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-trace-id': traceId,
          'x-session-id': this.config.sessionId,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const contentType = response.headers.get('content-type') ?? '';
      const raw = await response.text();
      const parsed = contentType.includes('text/event-stream')
        ? this.parseSseResponse(raw)
        : (JSON.parse(raw) as OpenAIResponseBody);

      if (!response.ok) {
        throw new Error(parsed.error?.message ?? `HTTP ${response.status}: ${raw}`);
      }

      const assistant = this.extractAssistantResponse(parsed);
      this.messages.push({
        role: 'assistant',
        content: assistant.content,
        tool_calls: assistant.tool_calls.length > 0 ? assistant.tool_calls : undefined,
      });
      return assistant;
    } catch (error) {
      this.messages.pop();
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`请求超时（${this.config.timeoutMs}ms）`);
      }
      if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        throw new Error(`无法连接到服务 ${this.config.baseUrl}，请确认服务已启动且允许 GUI 请求`);
      }
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseSseResponse(raw: string): OpenAIResponseBody {
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'));

    const chunks: any[] = [];
    for (const line of lines) {
      const payload = line.slice('data:'.length).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        chunks.push(JSON.parse(payload));
      } catch {
        // 忽略坏 chunk
      }
    }

    if (chunks.length === 0) {
      throw new Error('SSE 响应中未找到可解析的 chunk');
    }

    const first = chunks[0] ?? {};
    const toolCallsByIndex = new Map<number, any>();
    const contentParts: string[] = [];
    let finishReason = '';
    let usage: OpenAIResponseBody['usage'] = {};

    for (const chunk of chunks) {
      const choice = chunk?.choices?.[0] ?? {};
      const delta = choice?.delta ?? {};

      if (typeof delta?.content === 'string') {
        contentParts.push(delta.content);
      }

      if (Array.isArray(delta?.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const index = typeof tc?.index === 'number' ? tc.index : 0;
          const prev = toolCallsByIndex.get(index) ?? {
            index,
            id: tc?.id,
            type: tc?.type,
            function: {
              name: tc?.function?.name,
              arguments: '',
            },
          };

          if (tc?.id) prev.id = tc.id;
          if (tc?.type) prev.type = tc.type;
          if (tc?.function?.name) prev.function.name = tc.function.name;
          if (typeof tc?.function?.arguments === 'string') {
            prev.function.arguments += tc.function.arguments;
          }
          toolCallsByIndex.set(index, prev);
        }
      }

      if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
        finishReason = choice.finish_reason;
      }

      if (chunk?.usage && typeof chunk.usage === 'object') {
        usage = chunk.usage;
      }
    }

    return {
      id: first?.id,
      object: 'chat.completion',
      created: first?.created,
      model: first?.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: contentParts.join(''),
            tool_calls: Array.from(toolCallsByIndex.values()).sort((a, b) => a.index - b.index),
          },
          finish_reason: finishReason || 'stop',
        },
      ],
      usage,
    };
  }

  private extractAssistantResponse(response: OpenAIResponseBody): AssistantResponse {
    if (response.error) {
      throw new Error(`服务错误: ${response.error.message ?? JSON.stringify(response.error)}`);
    }

    const choice = response.choices?.[0];
    if (!choice?.message) {
      throw new Error('响应中没有可解析的 assistant message');
    }

    return {
      content: typeof choice.message.content === 'string' ? choice.message.content : '',
      tool_calls: Array.isArray(choice.message.tool_calls) ? choice.message.tool_calls : [],
      finish_reason: choice.finish_reason ?? '',
      usage: response.usage ?? {},
    };
  }

  private buildDefaultSessionId(): string {
    const now = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    return `gui-${now}-${rand}`;
  }

  private buildTraceId(): string {
    this.requestSeq += 1;
    return `${this.config.sessionId}-r${String(this.requestSeq).padStart(4, '0')}`;
  }
}
