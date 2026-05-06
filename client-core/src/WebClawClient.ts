import * as https from 'https';
import * as http from 'http';
import { ClientConfig, OpenAIRequestBody, OpenAIResponseBody, ChatMessage, AssistantResponse } from './types';
import { ClientRouteMode } from './core/types';

/**
 * WebClawProxy 客户端 API 层
 * 负责构造 OpenAI 协议格式请求并与服务端通信
 */
export class WebClawClient {
  private config: Required<ClientConfig>;
  private messages: ChatMessage[] = [];
  private requestSeq = 0;
  private routeMode: ClientRouteMode;

  constructor(config: ClientConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      model: config.model,
      stream: config.stream ?? false,
      routeMode: config.routeMode ?? 'web',
      system: config.system ?? '',
      tools: config.tools ?? [],
      timeoutMs: config.timeoutMs ?? 180000,
      sessionId: config.sessionId ?? this.buildDefaultSessionId(),
      traceEnabled: config.traceEnabled ?? true,
      tracePreviewChars: config.tracePreviewChars ?? 180,
    };
    this.routeMode = config.routeMode ?? 'web';
  }

  /** 设置系统提示词（会清空历史） */
  setSystem(system: string): void {
    this.config.system = system;
    this.clearHistory();
  }

  /** 切换模型（会清空历史） */
  setModel(model: string): void {
    this.config.model = model;
    this.clearHistory();
  }

  /** 开关流式请求 */
  setStream(enabled: boolean): void {
    this.config.stream = enabled;
    this.logTrace('stream_toggled', { enabled });
  }

  /** 设置可用工具列表（注入到请求 body.tools） */
  setTools(tools: unknown[]): void {
    this.config.tools = tools;
  }

  isStreamEnabled(): boolean {
    return this.config.stream;
  }

  /** 开关 trace 日志 */
  setTraceEnabled(enabled: boolean): void {
    this.config.traceEnabled = enabled;
    this.logTrace('trace_toggled', { enabled });
  }

  isTraceEnabled(): boolean {
    return this.config.traceEnabled;
  }

  /** 清空对话历史 */
  clearHistory(): void {
    this.messages = [];
    this.logTrace('history_cleared', {});
  }

  importHistory(messages: ChatMessage[]): void {
    this.messages = messages.map((message) => this.sanitizeMessage(message));
    this.logTrace('history_imported', { count: this.messages.length });
  }

  /** 获取当前对话历史（不含 system） */
  getHistory(): ChatMessage[] {
    return [...this.messages];
  }

  /** 获取当前配置 */
  getConfig(): Required<ClientConfig> {
    return { ...this.config };
  }

  setSessionId(sessionId: string): void {
    const trimmed = String(sessionId ?? '').trim();
    if (!trimmed) return;
    this.config.sessionId = trimmed;
    this.requestSeq = 0;
  }

  setRouteMode(mode: ClientRouteMode): void {
    this.routeMode = mode;
    this.config.routeMode = mode;
  }

  getRouteMode(): ClientRouteMode {
    return this.routeMode;
  }

  /**
   * 发送用户消息，返回助手回复（文本与工具调用分离）
   */
  async sendMessage(userContent: string): Promise<AssistantResponse> {
    const traceId = this.buildTraceId();

    this.messages.push({ role: 'user', content: userContent });

    const requestMessages: ChatMessage[] = [];
    if (this.config.system) {
      requestMessages.push({ role: 'system', content: this.config.system });
    }
    requestMessages.push(...this.messages.map((message) => this.sanitizeMessage(message)));

    const body: OpenAIRequestBody = {
      model: this.config.model,
      messages: requestMessages,
      tools: this.config.tools,
      stream: this.config.stream,
    };

    this.logTrace('request_built', {
      trace_id: traceId,
      session_id: this.config.sessionId,
      model: this.config.model,
      history_count: this.messages.length,
      request_message_count: requestMessages.length,
      request_roles: requestMessages.map((m) => m.role),
      user_content_preview: this.preview(userContent),
      system_enabled: Boolean(this.config.system),
      tools_count: this.config.tools.length,
      stream: this.config.stream,
    });

    let responseData: OpenAIResponseBody;
    try {
      responseData = await this.post('/v1/chat/completions', body, traceId);
    } catch (err) {
      this.messages.pop();
      this.logTrace('request_failed', {
        trace_id: traceId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const assistant = this.extractAssistantResponse(responseData, traceId);
    this.messages.push({
      role: 'assistant',
      content: assistant.content,
      tool_calls: assistant.tool_calls.length > 0 ? assistant.tool_calls : undefined,
    });

    this.logTrace('response_parsed', {
      trace_id: traceId,
      session_id: this.config.sessionId,
      assistant_preview: this.preview(assistant.content),
      tool_call_count: assistant.tool_calls.length,
      finish_reason: assistant.finish_reason,
      usage: assistant.usage,
      history_count_after: this.messages.length,
    });

    return assistant;
  }

  /**
   * 发送完整 messages（含 tool results）用于工具循环。
   * 不追加 user message 到内部 history，由外部管理 messages。
   */
  async sendRequest(messages: ChatMessage[]): Promise<AssistantResponse> {
    const traceId = this.buildTraceId();

    const requestMessages: ChatMessage[] = [];
    if (this.config.system) {
      requestMessages.push({ role: 'system', content: this.config.system });
    }
    requestMessages.push(...messages.map((m) => this.sanitizeMessage(m)));

    const body: OpenAIRequestBody = {
      model: this.config.model,
      messages: requestMessages,
      tools: this.config.tools,
      stream: this.config.stream,
    };

    this.logTrace('tool_loop_request', {
      trace_id: traceId,
      session_id: this.config.sessionId,
      model: this.config.model,
      message_count: requestMessages.length,
      roles: requestMessages.map((m) => m.role),
      tools_count: this.config.tools.length,
    });

    let responseData: OpenAIResponseBody;
    try {
      responseData = await this.post('/v1/chat/completions', body, traceId);
    } catch (err) {
      this.logTrace('tool_loop_request_failed', {
        trace_id: traceId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const assistant = this.extractAssistantResponse(responseData, traceId);

    this.logTrace('tool_loop_response', {
      trace_id: traceId,
      assistant_preview: this.preview(assistant.content),
      tool_call_count: assistant.tool_calls.length,
      finish_reason: assistant.finish_reason,
    });

    return assistant;
  }

  async listModels(): Promise<string[]> {
    const response = await this.get('/v1/models');
    const data = response as { object?: string; data?: { id: string }[] };
    if (data.object === 'list' && Array.isArray(data.data)) {
      return data.data.map((m) => m.id);
    }
    return [];
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.get('/health');
      const data = response as { status?: string };
      return data.status === 'ok';
    } catch {
      return false;
    }
  }

  private post(pathname: string, body: unknown, traceId: string): Promise<OpenAIResponseBody> {
    return new Promise((resolve, reject) => {
      const bodyStr = JSON.stringify(body);
      const url = new URL(this.config.baseUrl + pathname);
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
          'x-trace-id': traceId,
          'x-session-id': this.config.sessionId,
          'x-webclaw-mode': this.routeMode,
        },
        timeout: this.config.timeoutMs,
      };

      this.logTrace('http_send', {
        trace_id: traceId,
        method: 'POST',
        url: `${url.protocol}//${url.host}${url.pathname}`,
        timeout_ms: this.config.timeoutMs,
        headers: {
          'x-trace-id': traceId,
          'x-session-id': this.config.sessionId,
          'x-webclaw-mode': this.routeMode,
        },
      });

      const transport = url.protocol === 'https:' ? https : http;
      const req = transport.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          this.logTrace('http_response', {
            trace_id: traceId,
            status_code: res.statusCode ?? 0,
            content_type: res.headers['content-type'] ?? '',
            raw_preview: this.preview(data),
          });

          const contentType = String(res.headers['content-type'] ?? '').toLowerCase();
          try {
            const parsed = contentType.includes('text/event-stream')
              ? this.parseSseResponse(data, traceId)
              : (JSON.parse(data) as OpenAIResponseBody);

            if (res.statusCode && res.statusCode >= 400) {
              const errMsg = parsed.error?.message ?? `HTTP ${res.statusCode}: ${data}`;
              reject(new Error(errMsg));
              return;
            }
            resolve(parsed);
          } catch {
            reject(new Error(`响应解析失败: ${data}`));
          }
        });
      });

      req.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
          reject(new Error(`无法连接到服务 ${this.config.baseUrl}，请确认服务已启动`));
        } else {
          reject(err);
        }
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`请求超时（${this.config.timeoutMs}ms），服务可能正在等待浏览器响应`));
      });

      req.write(bodyStr);
      req.end();
    });
  }

  private get(pathname: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.config.baseUrl + pathname);
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        timeout: 10000,
      };

      const transport = url.protocol === 'https:' ? https : http;
      const req = transport.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`响应解析失败: ${data}`));
          }
        });
      });

      req.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
          reject(new Error(`无法连接到服务 ${this.config.baseUrl}`));
        } else {
          reject(err);
        }
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });

      req.end();
    });
  }

  private parseSseResponse(raw: string, traceId: string): OpenAIResponseBody {
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
        // 忽略单条坏 chunk，继续聚合其他 chunk
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
          if (tc?.function?.name) {
            prev.function.name = tc.function.name;
          }
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

    const toolCalls = Array.from(toolCallsByIndex.values()).sort((a, b) => a.index - b.index);

    const parsed: OpenAIResponseBody = {
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
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          finish_reason: finishReason || 'stop',
        },
      ],
      usage,
    };

    this.logTrace('sse_aggregated', {
      trace_id: traceId,
      chunk_count: chunks.length,
      content_length: parsed.choices?.[0]?.message?.content?.length ?? 0,
      tool_call_count: toolCalls.length,
      finish_reason: parsed.choices?.[0]?.finish_reason,
    });

    return parsed;
  }

  private extractAssistantResponse(response: OpenAIResponseBody, traceId: string): AssistantResponse {
    if (response.error) {
      throw new Error(`服务错误: ${response.error.message ?? JSON.stringify(response.error)}`);
    }

    const choice = response.choices?.[0];
    if (!choice) {
      throw new Error('响应中没有 choices 字段');
    }

    const message = choice.message;
    if (!message) {
      throw new Error('响应 choices[0] 中没有 message 字段');
    }

    const content = typeof message.content === 'string' ? message.content : '';
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

    if (toolCalls.length > 0) {
      this.logTrace('tool_calls_response', {
        trace_id: traceId,
        tool_call_count: toolCalls.length,
      });
    }

    return {
      content,
      tool_calls: toolCalls,
      finish_reason: choice.finish_reason ?? '',
      usage: response.usage ?? {},
    };
  }

  private buildDefaultSessionId(): string {
    const now = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    return `client-${now}-${rand}`;
  }

  private buildTraceId(): string {
    this.requestSeq += 1;
    return `${this.config.sessionId}-r${String(this.requestSeq).padStart(4, '0')}`;
  }

  private preview(text: string): string {
    if (!text) return '';
    const normalized = text.replace(/\s+/g, ' ').trim();
    return normalized.length > this.config.tracePreviewChars
      ? normalized.slice(0, this.config.tracePreviewChars) + '...'
      : normalized;
  }

  private sanitizeMessage(message: ChatMessage): ChatMessage {
    const next: ChatMessage = {
      role: message.role,
      content: message.content,
    };
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      next.tool_calls = message.tool_calls;
    }
    if (message.tool_call_id) {
      next.tool_call_id = message.tool_call_id;
    }
    if (message.name) {
      next.name = message.name;
    }
    return next;
  }

  private logTrace(stage: string, payload: Record<string, unknown>): void {
    if (!this.config.traceEnabled) return;
    try {
      console.log(`[ClientTrace] stage=${stage} payload=${JSON.stringify(payload)}`);
    } catch {
      console.log(`[ClientTrace] stage=${stage} payload=[unserializable]`);
    }
  }
}
