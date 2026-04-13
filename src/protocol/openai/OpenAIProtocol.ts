import { BaseProtocol } from '../BaseProtocol';
import {
  InternalRequest,
  InternalResponse,
  Message,
  Tool,
  ContentItem,
  ProtocolType,
  ProtocolParseError,
  ToolCall,
} from '../types';
import { OpenAIRequest, OpenAIResponse, OpenAIMessage } from './types';
import { v4 as uuidv4 } from 'uuid';

/**
 * OpenAI 协议转换器
 *
 * 负责将 OpenAI API 格式的请求转换为内部统一结构，
 * 以及将内部响应结构转换回 OpenAI API 格式。
 */
export class OpenAIProtocol extends BaseProtocol {
  private logProtocolTrace(traceId: string, stage: string, payload: Record<string, unknown>): void {
    try {
      console.log(`[ProtocolTrace][${traceId}] stage=${stage} payload=${JSON.stringify(payload)}`);
    } catch {
      console.log(`[ProtocolTrace][${traceId}] stage=${stage} payload=[unserializable]`);
    }
  }

  /**
   * 将 OpenAI API 请求转换为内部统一结构
   *
   * 提取规则：
   * - MODEL    = input.model
   * - SYSTEM   = 提取 messages 中所有 role=system 的文本内容并按顺序拼接
   * - HISTORY  = 过滤掉所有 role=system 后，再去掉最后一条
   * - TOOLS    = input.tools || []
   * - CURRENT  = 过滤后消息列表的最后一条
   */
  parse(input: unknown, options?: { traceId?: string; source?: string }): InternalRequest {
    const traceId = options?.traceId ?? `proto-${uuidv4().replace(/-/g, '').slice(0, 8)}`;
    const source = options?.source ?? 'unknown';
    const req = input as OpenAIRequest;

    // 校验必填字段
    if (!req || typeof req !== 'object') {
      throw new ProtocolParseError(
        ProtocolType.OPENAI,
        'OpenAI 请求格式无效：不是一个对象'
      );
    }

    if (!req.model || typeof req.model !== 'string') {
      throw new ProtocolParseError(
        ProtocolType.OPENAI,
        'OpenAI 请求缺少 model 字段'
      );
    }

    if (!Array.isArray(req.messages)) {
      throw new ProtocolParseError(
        ProtocolType.OPENAI,
        'OpenAI 请求 messages 字段必须是数组'
      );
    }

    // 1. 提取 MODEL
    const model = req.model;

    this.logProtocolTrace(traceId, 'input_overview', {
      source,
      model,
      message_count: req.messages.length,
      roles: req.messages.map((m: OpenAIMessage) => m.role),
      has_tools: Array.isArray(req.tools),
      tools_count: Array.isArray(req.tools) ? req.tools.length : 0,
    });

    // 2. 提取 SYSTEM，并过滤掉所有 system 消息（保持其余消息原有顺序）
    const systemParts: string[] = [];
    const nonSystemMessages: Message[] = [];

    for (const msg of req.messages) {
      if (msg.role === 'system') {
        const part = this.extractTextContent(msg);
        if (part !== '') systemParts.push(part);
        continue;
      }
      nonSystemMessages.push(this.normalizeMessage(msg));
    }

    const system = systemParts.join('\n\n');

    this.logProtocolTrace(traceId, 'after_system_filter', {
      source,
      system_parts_count: systemParts.length,
      filtered_non_system_count: nonSystemMessages.length,
      filtered_non_system_roles: nonSystemMessages.map((m) => m.role),
    });

    // 3. 提取 TOOLS
    const tools: Tool[] = Array.isArray(req.tools) ? req.tools : [];

    // 4. 提取 CURRENT（最后一条消息，从 HISTORY 中移除）
    if (nonSystemMessages.length === 0) {
      throw new ProtocolParseError(
        ProtocolType.OPENAI,
        'OpenAI 请求 messages 中没有可用的非 system 消息'
      );
    }

    const history = nonSystemMessages.slice(0, -1);
    const current = nonSystemMessages[nonSystemMessages.length - 1];

    this.logProtocolTrace(traceId, 'split_history_current', {
      source,
      model,
      history_count: history.length,
      history_roles: history.map((m) => m.role),
      current_role: current.role,
      current_content_type: Array.isArray(current.content) ? 'array' : typeof current.content,
      current_has_tool_calls: Array.isArray(current.tool_calls) && current.tool_calls.length > 0,
      tools_count: tools.length,
    });

    return {
      model,
      system,
      history,
      tools,
      current,
    };
  }

  /**
   * 将内部响应字段转换为 OpenAI API 格式
   */
  format(
    model: string,
    messagePayload: Pick<InternalResponse, 'content' | 'tool_calls' | 'finish_reason'>,
    usage?: InternalResponse['usage']
  ): OpenAIResponse {
    const now = Math.floor(Date.now() / 1000);
    const id = `chatcmpl-${uuidv4().replace(/-/g, '').substring(0, 20)}`;

    const message: {
      role: string;
      content: string | null;
      tool_calls?: object[];
    } = {
      role: 'assistant',
      content: messagePayload.content ?? null,
    };

    if (messagePayload.tool_calls && messagePayload.tool_calls.length > 0) {
      message.tool_calls = messagePayload.tool_calls.map((tc: ToolCall) => ({
        id: tc.id ?? `call_${uuidv4().replace(/-/g, '').substring(0, 20)}`,
        type: tc.type ?? 'function',
        function: tc.function,
        index: tc.index ?? 0,
      }));
    }

    const finishReason =
      messagePayload.finish_reason ??
      (messagePayload.tool_calls && messagePayload.tool_calls.length > 0
        ? 'tool_calls'
        : 'stop');

    return {
      id,
      object: 'chat.completion',
      created: now,
      model: model || 'unknown',
      choices: [
        {
          index: 0,
          message,
          logprobs: null,
          finish_reason: finishReason,
        },
      ],
      usage: {
        prompt_tokens: usage?.prompt_tokens ?? 0,
        completion_tokens: usage?.completion_tokens ?? 0,
        total_tokens:
          usage?.total_tokens ??
          (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0),
      },
    };
  }

  private normalizeMessage(msg: OpenAIMessage): Message {
    let content: string | ContentItem[];

    if (typeof msg.content === 'string') {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content as ContentItem[];
    } else if (msg.content === null || msg.content === undefined) {
      content = '';
    } else {
      content = String(msg.content);
    }

    return {
      role: msg.role,
      content,
      tool_calls: Array.isArray(msg.tool_calls)
        ? msg.tool_calls.map((tc) => ({
            index: tc.index,
            id: tc.id,
            type: tc.type,
            function: tc.function,
          }))
        : undefined,
    };
  }

  private extractTextContent(msg: OpenAIMessage): string {
    if (typeof msg.content === 'string') {
      return msg.content;
    }

    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((item: ContentItem) => item.type === 'text')
        .map((item: ContentItem) => item.text ?? '')
        .join('\n');
    }

    return '';
  }
}
