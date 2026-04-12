import * as https from 'https';
import * as http from 'http';
import { ClientConfig, OpenAIRequestBody, OpenAIResponseBody, ChatMessage, AssistantResponse } from './types';

/**
 * WebClawProxy 客户端 API 层
 * 负责构造 OpenAI 协议格式请求并与服务端通信
 */
export class WebClawClient {
  private config: Required<ClientConfig>;
  private messages: ChatMessage[] = [];
  private requestSeq = 0;

  constructor(config: ClientConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      model: config.model,
      system: config.system ?? '',
      timeoutMs: config.timeoutMs ?? 180000,
      sessionId: config.sessionId ?? this.buildDefaultSessionId(),
      traceEnabled: config.traceEnabled ?? true,
      tracePreviewChars: config.tracePreviewChars ?? 180,
    };
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

  /** 获取当前对话历史（不含 system） */
  getHistory(): ChatMessage[] {
    return [...this.messages];
  }

  /** 获取当前配置 */
  getConfig(): Required<ClientConfig> {
    return { ...this.config };
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
    requestMessages.push(...this.messages);

    const body: OpenAIRequestBody = {
      model: this.config.model,
      messages: requestMessages,
      stream: false,
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
            raw_preview: this.preview(data),
          });

          try {
            const parsed = JSON.parse(data) as OpenAIResponseBody;
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

  private logTrace(stage: string, payload: Record<string, unknown>): void {
    if (!this.config.traceEnabled) return;
    try {
      console.log(`[ClientTrace] stage=${stage} payload=${JSON.stringify(payload)}`);
    } catch {
      console.log(`[ClientTrace] stage=${stage} payload=[unserializable]`);
    }
  }
}
