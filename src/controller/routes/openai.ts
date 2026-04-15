import { Request, Response, NextFunction } from 'express';
import { OpenAIProtocol } from '../../protocol';
import { DataManager } from '../../data-manager/DataManager';
import { WebDriverManager } from '../../web-driver/WebDriverManager';
import { SiteKey } from '../../web-driver/types';
import { WebDriverError, WebDriverErrorCode } from '../../web-driver/types';
import { ProtocolParseError } from '../../protocol/types';
import { logDebug, stringifyLogPayload, formatRequestBodyPreview } from '../logger';
import {
  type ForwardModeConfig,
  getNormalizedProviderConfig,
  getNormalizedProviderConfigMap,
  isSiteKey,
  normalizeProviderConfig,
  type NormalizedProviderConfig,
} from '../../config/provider-config';
import { loadAppConfig } from '../../config/app-config';

const config = loadAppConfig();

const protocol = new OpenAIProtocol();
const webDriver = new WebDriverManager();

function getConfiguredSiteKeys(): SiteKey[] {
  return Object.entries(getNormalizedProviderConfigMap())
    .filter(([providerKey, provider]) => isSiteKey(providerKey) && provider.default_mode === 'web')
    .map(([providerKey]) => providerKey as SiteKey);
}

export async function preflightWebDriverSites(): Promise<void> {
  const siteKeys = getConfiguredSiteKeys();
  if (siteKeys.length === 0) return;
  await webDriver.preflightConfiguredSites(siteKeys);
}

export async function openConfiguredWebDriverSites(): Promise<void> {
  const siteKeys = getConfiguredSiteKeys();
  if (siteKeys.length === 0) return;
  await webDriver.openConfiguredSites(siteKeys);
}

export async function closeWebDriver(): Promise<void> {
  await webDriver.close();
}

/**
 * 根据模型名称推断使用哪个网站
 * 优先使用 providers 映射（site + models 同源），并兼容旧配置。
 */
function inferProviderFromModel(model: string): string {
  const providers = getNormalizedProviderConfigMap();

  for (const [providerKey, provider] of Object.entries(providers)) {
    const modelList = provider.models ?? [];
    if (modelList.some((m: string) => m.toLowerCase() === model.toLowerCase())) {
      return providerKey;
    }
  }

  // 模糊匹配
  const lower = model.toLowerCase();
  if (lower.startsWith('gpt') || lower.startsWith('o1') || lower.startsWith('o3')) return 'gpt';
  if (lower.startsWith('deepseek')) return 'deepseek';
  if (lower.startsWith('qwen')) return 'qwen';
  if (lower.startsWith('moonshot') || lower.startsWith('kimi')) return 'kimi';
  if (lower.startsWith('glm')) return 'glm';

  // 默认使用 gpt
  return 'gpt';
}

function buildUpstreamChatCompletionsUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  if (normalizedBaseUrl.endsWith('/chat/completions')) {
    return normalizedBaseUrl;
  }
  return `${normalizedBaseUrl}/chat/completions`;
}

function sanitizeForwardHeaders(headers: ForwardModeConfig['headers']): Record<string, string> {
  if (!headers || typeof headers !== 'object') return {};
  const sanitizedEntries = Object.entries(headers).filter(
    ([key, value]) => typeof key === 'string' && typeof value === 'string' && key.trim() && value.trim()
  );
  return Object.fromEntries(sanitizedEntries);
}

async function sendForwardRequest(
  res: Response,
  options: {
    traceId: string;
    providerKey: string;
    providerConfig: NormalizedProviderConfig;
    requestBody: Record<string, unknown>;
  }
): Promise<void> {
  const { traceId, providerKey, providerConfig } = options;
  const forwardConfig = providerConfig.forward;

  if (!forwardConfig.base_url || !forwardConfig.api_key) {
    res.status(500).json({
      error: {
        message: `provider ${providerKey} 缺少 base_url 或 api_key 配置`,
        type: 'configuration_error',
        code: 'FORWARD_PROVIDER_MISCONFIGURED',
      },
    });
    return;
  }

  const upstreamUrl = buildUpstreamChatCompletionsUrl(forwardConfig.base_url);
  const requestBody = { ...options.requestBody };
  const originalModel = typeof requestBody.model === 'string' ? requestBody.model : '';
  const mappedModel = forwardConfig.upstream_model_map?.[originalModel];
  if (mappedModel) {
    requestBody.model = mappedModel;
  }

  const upstreamHeaders: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${forwardConfig.api_key}`,
    ...sanitizeForwardHeaders(forwardConfig.headers),
  };

  const controller = new AbortController();
  const timeoutMs = forwardConfig.timeout_ms ?? 120000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  logDebug('forward_request', {
    traceId,
    provider: providerKey,
    upstreamUrl,
    stream: Boolean(requestBody.stream),
    model: requestBody.model,
  });

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const contentType = upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8';
    res.status(upstreamResponse.status);
    res.setHeader('content-type', contentType);

    const cacheControl = upstreamResponse.headers.get('cache-control');
    if (cacheControl) res.setHeader('cache-control', cacheControl);

    const isStream = Boolean(requestBody.stream);
    if (isStream && upstreamResponse.body) {
      const reader = upstreamResponse.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            res.write(Buffer.from(value));
          }
        }
        res.end();
      } finally {
        reader.releaseLock();
      }
      return;
    }

    const bodyText = await upstreamResponse.text();
    res.send(bodyText);
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? `转发到上游超时（>${timeoutMs}ms）`
        : error instanceof Error
          ? error.message
          : '转发到上游失败';

    console.error(`[Forward][${traceId}] provider=${providerKey} upstream_error=${message}`);
    res.status(502).json({
      error: {
        message,
        type: 'upstream_error',
        code: 'UPSTREAM_REQUEST_FAILED',
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 尝试将“看起来像 JSON”的文本规范化为严格 JSON 字符串
 * 支持：
 * - ```json code fence
 * - JSONC 风格注释（行注释与块注释）
 * - 末尾多余逗号
 */
function normalizeJsonLike(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const normalizedInput = repairMalformedToolCallArguments(normalizeJsonArtifacts(trimmed));

  // 先尝试严格 JSON
  try {
    const obj = parseJsonLikeObject(normalizedInput);
    return JSON.stringify(normalizeCompletionJsonShape(obj));
  } catch {
    // ignore
  }

  // 去注释 + 去末尾逗号，再尝试
  const noComments = stripJsonComments(normalizedInput);
  const noTrailingComma = stripTrailingCommas(noComments);
  try {
    const obj = parseJsonLikeObject(noTrailingComma);
    return JSON.stringify(normalizeCompletionJsonShape(obj));
  } catch {
    // ignore
  }

  // 针对 message.content / tool_calls.function.arguments 等字段中“未转义双引号”做定向修复
  const repairedQuoteFields = repairUnescapedQuotesInFields(noTrailingComma, ['content', 'arguments']);
  try {
    const obj = parseJsonLikeObject(repairedQuoteFields);
    return JSON.stringify(normalizeCompletionJsonShape(obj));
  } catch {
    return null;
  }
}

function parseJsonLikeObject(input: string): any {
  return JSON.parse(repairInvalidJsonStringEscapes(input));
}

function normalizeCompletionJsonShape(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj.choices)) {
    obj.choices = obj.choices.map((choice: any) => normalizeChoiceLikeObject(choice));
    return obj;
  }

  return normalizeChoiceLikeObject(obj);
}

function normalizeChoiceLikeObject(choice: any): any {
  if (!choice || typeof choice !== 'object') return choice;

  if (typeof choice.index !== 'number') {
    choice.index = 0;
  }

  if (!Object.prototype.hasOwnProperty.call(choice, 'logprobs')) {
    choice.logprobs = null;
  }

  // 兼容部分模型输出 finishreason/toolcalls 这类非标准字段名
  if (choice.finish_reason == null && typeof choice.finishreason === 'string') {
    const raw = String(choice.finishreason).trim().toLowerCase();
    choice.finish_reason = raw === 'toolcalls' ? 'tool_calls' : raw;
  }

  const message = choice.message;
  if (message && typeof message === 'object' && !Array.isArray(message)) {
    if (!Array.isArray(message.tool_calls) && Array.isArray(message.toolcalls)) {
      message.tool_calls = message.toolcalls;
    }
    if (Array.isArray(message.tool_calls)) {
      message.tool_calls = normalizeToolCalls(message.tool_calls);
    }
  }

  if (choice.finish_reason == null) {
    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    choice.finish_reason = toolCalls.length > 0 ? 'tool_calls' : 'stop';
  }

  return choice;
}

function normalizeToolCalls(toolCalls: any[]): any[] {
  return toolCalls.map((toolCall, index) => {
    if (!toolCall || typeof toolCall !== 'object') return toolCall;

    const next = { ...toolCall };
    if (typeof next.index !== 'number') {
      next.index = index;
    }

    if (next.function && typeof next.function === 'object') {
      next.function = { ...next.function };
      const args = next.function.arguments;
      if (typeof args === 'string') {
        next.function.arguments = normalizeToolCallArgumentsString(args);
      } else if (args && typeof args === 'object') {
        next.function.arguments = JSON.stringify(args);
      }
    }

    return next;
  });
}

function normalizeToolCallArgumentsString(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return input;

  const normalized = tryNormalizeEmbeddedJson(trimmed);
  return normalized ?? input;
}

function tryNormalizeEmbeddedJson(input: string): string | null {
  try {
    return JSON.stringify(parseJsonLikeObject(input));
  } catch {
    // ignore
  }

  const noComments = stripJsonComments(input);
  const noTrailingComma = stripTrailingCommas(noComments);
  try {
    return JSON.stringify(parseJsonLikeObject(noTrailingComma));
  } catch {
    // ignore
  }

  const repairedQuotes = repairUnescapedQuotesInFields(noTrailingComma, ['command', 'arguments', 'path', 'content']);
  try {
    return JSON.stringify(parseJsonLikeObject(repairedQuotes));
  } catch {
    return null;
  }
}

function repairMalformedToolCallArguments(text: string): string {
  // 兼容部分模型输出："arguments": "{"path":"downloads/player.txt"}"
  // 这种写法内部引号未转义，属于非法 JSON；这里做定向修复。
  // 关键：不能仅凭是否包含 \" 判断是否已合法；复杂命令可能“部分已转义 + 部分未转义”。
  return text.replace(
    /("arguments"\s*:\s*)"\{([\s\S]*?)\}"/g,
    (_all, prefix: string, inner: string) => {
      const hasUnescapedQuote = /(^|[^\\])"/.test(inner);
      if (!hasUnescapedQuote) {
        return _all;
      }

      const raw = `{${inner}}`;
      const escaped = raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `${prefix}"${escaped}"`;
    }
  );
}

function repairInvalidJsonStringEscapes(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (!inString) {
      out += ch;
      if (ch === '"') {
        inString = true;
      }
      continue;
    }

    if (escaped) {
      if (ch === 'u') {
        out += `\\${ch}`;
      } else if (/["\\/bfnrt]/.test(ch)) {
        out += `\\${ch}`;
      } else {
        out += `\\\\${ch}`;
      }
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    out += ch;
    if (ch === '"') {
      inString = false;
    }
  }

  if (escaped) {
    out += '\\\\';
  }

  return out;
}

function repairUnescapedQuotesInFields(text: string, fields: string[]): string {
  let result = text;
  for (const field of fields) {
    result = repairUnescapedQuotesInField(result, field);
  }
  return result;
}

function repairUnescapedQuotesInField(text: string, fieldName: string): string {
  const pattern = new RegExp(`"${fieldName}"\\s*:\\s*"`, 'g');
  let cursor = 0;
  let out = '';

  while (true) {
    pattern.lastIndex = cursor;
    const match = pattern.exec(text);
    if (!match) {
      out += text.slice(cursor);
      break;
    }

    const valueStart = match.index + match[0].length;
    out += text.slice(cursor, valueStart);

    let i = valueStart;
    let escaped = false;
    while (i < text.length) {
      const ch = text[i];

      if (ch === '"' && !escaped) {
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;

        if (j < text.length && (text[j] === ',' || text[j] === '}' || text[j] === ']')) {
          out += '"';
          i += 1;
          break;
        }

        // 非终止引号，视为字符串内部未转义引号
        out += '\\"';
        i += 1;
        escaped = false;
        continue;
      }

      out += ch;

      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      }

      i += 1;
    }

    cursor = i;
  }

  return out;
}

/**
 * 清理常见网页渲染噪声，提升 JSON 识别稳定性
 */
function normalizeJsonArtifacts(text: string): string {
  const noBomAndInvisible = text
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
    .replace(/[\u00A0\u202F]/g, ' ');

  // 兼容“代码块行号”场景（如: "12  \"key\": \"value\"")
  const withoutLineNumbers = noBomAndInvisible
    .split('\n')
    .map((line) => line.replace(/^\s*\d+\s+(?=[\[{\]}",\-\w])/, ''))
    .join('\n');

  // 清理常见代码块噪声行（不影响 JSON 字符串内容）
  const withoutUiNoise = withoutLineNumbers
    .split('\n')
    .filter((line) => !/^\s*(copy code|复制代码|jsonc?|javascript|js|typescript|ts)\s*$/i.test(line.trim()))
    .join('\n');

  // 统一常见全角标点/引号（部分站点 markdown 渲染会出现）
  return withoutUiNoise
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/，/g, ',')
    .replace(/：/g, ':')
    .replace(/｛/g, '{')
    .replace(/｝/g, '}')
    .replace(/［/g, '[')
    .replace(/］/g, ']');
}

/**
 * 移除 JSONC 注释（保留字符串内部内容）
 */
function stripJsonComments(text: string): string {
  let result = '';
  let inString = false;
  let quoteChar = '';
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';

    if (inString) {
      result += ch;
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === quoteChar) {
        inString = false;
        quoteChar = '';
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quoteChar = ch;
      result += ch;
      continue;
    }

    // 行注释 // ...
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
      if (i < text.length) result += '\n';
      continue;
    }

    // 块注释 /* ... */
    if (ch === '/' && next === '*') {
      i += 2;
      while (i + 1 < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++; // 跳过 '/'
      continue;
    }

    result += ch;
  }

  return result;
}

/**
 * 移除对象/数组中的末尾逗号（保留字符串内部内容）
 */
function stripTrailingCommas(text: string): string {
  let result = '';
  let inString = false;
  let quoteChar = '';
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      result += ch;
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === quoteChar) {
        inString = false;
        quoteChar = '';
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quoteChar = ch;
      result += ch;
      continue;
    }

    if (ch === ',') {
      // 观察后续非空白字符，若是 ] 或 } 则忽略该逗号
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (j < text.length && (text[j] === ']' || text[j] === '}')) {
        continue;
      }
    }

    result += ch;
  }

  return result;
}

/**
 * 从文本中提取所有平衡的 JSON 块（对象或数组）
 */
function extractBalancedJsonLikeBlocks(content: string): string[] {
  const blocks: string[] = [];

  for (let start = 0; start < content.length; start++) {
    if (content[start] !== '{' && content[start] !== '[') continue;

    const stack: string[] = [];
    let inString = false;
    let quoteChar = '';
    let escape = false;

    for (let i = start; i < content.length; i++) {
      const ch = content[i];

      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === quoteChar) {
          inString = false;
          quoteChar = '';
        }
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = true;
        quoteChar = ch;
        continue;
      }

      if (ch === '{' || ch === '[') {
        stack.push(ch);
        continue;
      }

      if (ch === '}' || ch === ']') {
        const top = stack[stack.length - 1];
        if ((ch === '}' && top === '{') || (ch === ']' && top === '[')) {
          stack.pop();
          if (stack.length === 0) {
            blocks.push(content.slice(start, i + 1));
            start = i;
            break;
          }
        }
      }
    }
  }

  return blocks;
}

/**
 * 从模型输出中提取 JSON（处理 markdown 代码块、JSONC 注释等情况）
 * 返回值为“严格 JSON 字符串”（可直接 JSON.parse）
 */
function extractJson(content: string): string | null {
  const candidates: string[] = [];

  // 1) 整体内容
  candidates.push(content);

  // 2) code fence（可能多个，语言标记不限）
  const codeBlocks = content.match(/```[^\n`]*\s*\n?([\s\S]*?)\n?```/g) || [];
  for (const block of codeBlocks) {
    const m = block.match(/```[^\n`]*\s*\n?([\s\S]*?)\n?```/);
    if (m?.[1]) candidates.push(m[1]);
  }

  // 3) 所有平衡 JSON 块（避免只取第一个导致误判）
  candidates.push(...extractBalancedJsonLikeBlocks(content));

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = candidate.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const normalized = normalizeJsonLike(candidate);
    if (normalized) return normalized;
  }

  return null;
}


interface UpstreamServiceError {
  status: number;
  type: string;
  code: string;
  message: string;
}

/**
 * 从上游模型的纯文本回复中识别服务错误
 * 例如额度耗尽、服务繁忙、稍后重试等情况。
 */
function detectUpstreamServiceError(content: string): UpstreamServiceError | null {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const quotaPatterns = [
    /已达到使用额度上限/i,
    /usage limit/i,
    /quota exceeded/i,
    /rate limit/i,
    /credits? exhausted/i,
    /too many requests/i,
  ];

  if (quotaPatterns.some((pattern) => pattern.test(normalized))) {
    return {
      status: 429,
      type: 'rate_limit_error',
      code: 'quota_exceeded',
      message: normalized,
    };
  }

  const servicePatterns = [
    /service unavailable/i,
    /temporarily unavailable/i,
    /try again later/i,
    /server error/i,
    /internal server error/i,
    /服务端错误/i,
    /服务不可用/i,
    /服务繁忙/i,
    /稍后再试/i,
    /overloaded/i,
  ];

  if (servicePatterns.some((pattern) => pattern.test(normalized))) {
    return {
      status: 503,
      type: 'service_unavailable',
      code: 'upstream_service_error',
      message: normalized,
    };
  }

  return null;
}

/**
 * 发送结构化错误响应
 */
function sendUpstreamServiceError(res: Response, upstreamError: UpstreamServiceError): void {
  res.status(upstreamError.status).json({
    error: {
      message: upstreamError.message,
      type: upstreamError.type,
      code: upstreamError.code,
    },
  });
}

interface ContextSwitchConfig {
  enabled: boolean;
  max_prompt_tokens?: number;
  max_total_tokens?: number;
}

function getContextSwitchConfig(): ContextSwitchConfig {
  const raw = config.context_switch ?? {};
  return {
    enabled: Boolean(raw.enabled),
    max_prompt_tokens:
      typeof raw.max_prompt_tokens === 'number' ? raw.max_prompt_tokens : undefined,
    max_total_tokens:
      typeof raw.max_total_tokens === 'number' ? raw.max_total_tokens : undefined,
  };
}

function shouldSwitchContextByUsage(dm: DataManager): boolean {
  const switchConfig = getContextSwitchConfig();
  if (!switchConfig.enabled) return false;

  const usage = dm.get_usage()?.usage;
  if (!usage) return false;

  const exceedPrompt =
    typeof switchConfig.max_prompt_tokens === 'number' &&
    switchConfig.max_prompt_tokens > 0 &&
    usage.prompt_tokens >= switchConfig.max_prompt_tokens;

  const exceedTotal =
    typeof switchConfig.max_total_tokens === 'number' &&
    switchConfig.max_total_tokens > 0 &&
    usage.total_tokens >= switchConfig.max_total_tokens;

  return exceedPrompt || exceedTotal;
}

function logSessionTrace(stage: string, dm: DataManager, traceId?: string): void {
  const debug = dm.get_session_debug_info();
  const prefix = traceId ? `[SessionTrace][${traceId}]` : '[SessionTrace]';
  console.log(
    `${prefix} stage=${stage} hash=${debug.hash_key} linked=${debug.linked} ` +
      `url_count=${debug.web_url_count} session_dir=${debug.session_dir} data_path=${debug.data_path} ` +
      `latest_url=${debug.latest_web_url || '-'}`
  );
}

function buildRequestTraceId(req: Request): string {
  const fromHeader = (req.headers['x-trace-id'] as string | undefined)?.trim();
  if (fromHeader) return fromHeader;
  const now = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `req-${now}-${rand}`;
}

function logRequestTrace(
  traceId: string,
  stage: string,
  payload: Record<string, unknown>
): void {
  try {
    console.log(`[RequestTrace][${traceId}] stage=${stage} payload=${stringifyLogPayload(payload)}`);
  } catch {
    console.log(`[RequestTrace][${traceId}] stage=${stage} payload=[unserializable]`);
  }
}

function buildContentPreview(content: string, maxLength = 200): string {
  return content
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

type StreamChunkDelta = {
  role?: 'assistant';
  content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
};

type StreamChunk = {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  system_fingerprint?: string;
  choices: Array<{
    index: 0;
    delta: StreamChunkDelta;
    logprobs: null;
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
};

function initSseHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function writeSseData(res: Response, payload: StreamChunk | '[DONE]'): void {
  if (payload === '[DONE]') {
    res.write('data: [DONE]\n\n');
    return;
  }
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function splitIntoParts(text: string, partSize = 2): string[] {
  const units = Array.from(text ?? '');
  if (units.length === 0) return [];
  const chunks: string[] = [];
  for (let i = 0; i < units.length; i += Math.max(1, partSize)) {
    chunks.push(units.slice(i, i + Math.max(1, partSize)).join(''));
  }
  return chunks;
}

function buildStreamChunksFromFormattedResponse(formattedResponse: any): StreamChunk[] {
  const id = String(formattedResponse?.id ?? `chatcmpl-${Date.now()}`);
  const created = Number(formattedResponse?.created ?? Math.floor(Date.now() / 1000));
  const model = String(formattedResponse?.model ?? 'unknown');
  const systemFingerprint =
    typeof formattedResponse?.system_fingerprint === 'string'
      ? formattedResponse.system_fingerprint
      : undefined;

  const choice = formattedResponse?.choices?.[0] ?? {};
  const message = choice?.message ?? {};
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : 'stop';
  const content = typeof message?.content === 'string' ? message.content : '';
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];

  const base = {
    id,
    object: 'chat.completion.chunk' as const,
    created,
    model,
    system_fingerprint: systemFingerprint,
  };

  const chunks: StreamChunk[] = [];

  chunks.push({
    ...base,
    choices: [{ index: 0, delta: { role: 'assistant', content: '' }, logprobs: null, finish_reason: null }],
  });

  for (const part of splitIntoParts(content, 2)) {
    chunks.push({
      ...base,
      choices: [{ index: 0, delta: { content: part }, logprobs: null, finish_reason: null }],
    });
  }

  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i] ?? {};
    const tcId = typeof tc?.id === 'string' ? tc.id : `call_${i}`;
    const tcType = tc?.type === 'function' ? 'function' : 'function';
    const fnName = typeof tc?.function?.name === 'string' ? tc.function.name : '';
    const args = typeof tc?.function?.arguments === 'string' ? tc.function.arguments : '';

    chunks.push({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: i,
                id: tcId,
                type: tcType,
                function: {
                  name: fnName,
                  arguments: '',
                },
              },
            ],
          },
          logprobs: null,
          finish_reason: null,
        },
      ],
    });

    for (const argPart of splitIntoParts(args, 2)) {
      chunks.push({
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: i,
                  function: {
                    arguments: argPart,
                  },
                },
              ],
            },
            logprobs: null,
            finish_reason: null,
          },
        ],
      });
    }
  }

  chunks.push({
    ...base,
    choices: [{ index: 0, delta: { content: '' }, logprobs: null, finish_reason: finishReason }],
    usage: formattedResponse?.usage,
  });

  return chunks;
}

function sendSseStreamFromFormattedResponse(res: Response, formattedResponse: any): void {
  initSseHeaders(res);
  const chunks = buildStreamChunksFromFormattedResponse(formattedResponse);
  for (const chunk of chunks) {
    writeSseData(res, chunk);
  }
  writeSseData(res, '[DONE]');
  res.end();
}

/**
 * POST /v1/chat/completions — OpenAI 兼容接口处理器
 */
export async function chatCompletionsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const traceId = buildRequestTraceId(req);
    const requestBody = req.body as Record<string, unknown>;
    const messageCount = Array.isArray(requestBody?.messages) ? requestBody.messages.length : 0;
    logRequestTrace(traceId, 'request_received', {
      method: req.method,
      path: req.path,
      model: requestBody?.model,
      stream: requestBody?.stream === true,
      message_count: messageCount,
      cookie_present: Boolean(req.headers.cookie),
      authorization_present: Boolean(req.headers.authorization),
      user_agent: req.headers['user-agent'] ?? '',
      x_forwarded_for: req.headers['x-forwarded-for'] ?? '',
      remote_ip: req.ip,
      session_header: (req.headers['x-session-id'] as string | undefined) ?? '',
    });
    logDebug('chat_completions_request_body', {
      trace_id: traceId,
      body_preview: formatRequestBodyPreview(requestBody ?? {}),
    });

    const requestedModel = typeof requestBody?.model === 'string' ? requestBody.model : '';
    if (!requestedModel) {
      res.status(400).json({
        error: {
          message: '请求格式错误: OpenAI 请求缺少 model 字段',
          type: 'invalid_request_error',
          code: 'invalid_request',
        },
      });
      return;
    }

    const providerKey = inferProviderFromModel(requestedModel);
    const providerConfig = getNormalizedProviderConfig(providerKey);
    const providerMode = providerConfig?.default_mode ?? 'web';

    if (providerMode === 'forward') {
      await sendForwardRequest(res, {
        traceId,
        providerKey,
        providerConfig: providerConfig ?? normalizeProviderConfig(undefined),
        requestBody,
      });
      return;
    }

    if (!isSiteKey(providerKey)) {
      res.status(500).json({
        error: {
          message: `provider ${providerKey} 未配置为受支持的 web provider`,
          type: 'configuration_error',
          code: 'unsupported_web_provider',
        },
      });
      return;
    }

    const site = providerKey;

    // ===== Step 1: 解析协议 =====
    let internalReq;
    try {
      internalReq = protocol.parse(req.body, { traceId, source: 'chatCompletionsHandler' });
    } catch (err) {
      if (err instanceof ProtocolParseError) {
        res.status(400).json({
          error: {
            message: `请求格式错误: ${err.message}`,
            type: 'invalid_request_error',
            code: 'invalid_request',
          },
        });
        return;
      }
      throw err;
    }

    // ===== Step 2: 初始化 DataManager =====
    const dm = new DataManager(internalReq);
    dm.set_trace_id(traceId);
    logSessionTrace('init_dm', dm, traceId);

    const initPromptForNewSession = dm.get_init_prompt_for_new_session();
    
    // ===== Step 3: 保存数据 =====
    await dm.save_data();
    logSessionTrace('after_save_request', dm, traceId);

    // ===== Step 4: 判断链接状态，初始化或获取 session URL =====
    let sessionUrl: string;

    const initializeConversationAndBind = async (): Promise<string> => {
      logSessionTrace('before_init_conversation', dm, traceId);
      let initResult;
      try {
        initResult = await webDriver.initConversation(site, initPromptForNewSession);
      } catch (err) {
        if (err instanceof WebDriverError) {
          if (err.code === WebDriverErrorCode.NOT_LOGGED_IN) {
            res.status(401).json({
              error: {
                message: '用户未登录，请打开浏览器完成登录',
                type: 'authentication_error',
                code: 'not_logged_in',
              },
            });
            throw err;
          }
          if (err.code === WebDriverErrorCode.DIALOG_BLOCKED) {
            res.status(503).json({
              error: {
                message: '界面被弹窗遮挡，无法创建新对话',
                type: 'service_unavailable',
                code: 'dialog_blocked',
              },
            });
            throw err;
          }
        }
        throw err;
      }

      const newSessionUrl = initResult.url;
      logSessionTrace('after_init_conversation_url_ready', dm, traceId);
      dm.update_web_url(newSessionUrl);
      logSessionTrace('after_bind_new_session_url', dm, traceId);
      return newSessionUrl;
    };

    if (!dm.is_linked()) {
      logSessionTrace('before_link_check_unlinked', dm, traceId);
      // 未链接：初始化对话
      console.log(`[Controller] 模型 ${internalReq.model} 未链接，开始初始化对话...`);
      try {
        sessionUrl = await initializeConversationAndBind();
      } catch (err) {
        if (err instanceof WebDriverError) {
          if (
            err.code === WebDriverErrorCode.NOT_LOGGED_IN ||
            err.code === WebDriverErrorCode.DIALOG_BLOCKED
          ) {
            return;
          }
        }
        throw err;
      }
      console.log(`[Controller] 对话初始化完成，URL: ${sessionUrl}`);

    } else {
      logSessionTrace('before_link_check_linked', dm, traceId);
      // 已链接：直接获取 session URL
      sessionUrl = dm.get_web_url();
      console.log(`[Controller] 使用已有对话，URL: ${sessionUrl}`);

      if (shouldSwitchContextByUsage(dm)) {
        console.log(`[Controller] 检测到上下文额度接近阈值，切换到新会话...`);
        try {
          sessionUrl = await initializeConversationAndBind();
        } catch (err) {
          if (err instanceof WebDriverError) {
            if (
              err.code === WebDriverErrorCode.NOT_LOGGED_IN ||
              err.code === WebDriverErrorCode.DIALOG_BLOCKED
            ) {
              return;
            }
          }
          throw err;
        }
        console.log(`[Controller] 已切换新会话，URL: ${sessionUrl}`);
      }
    }

    // ===== Step 6: 发送当前消息 =====
    const responseSchemaTemplate = dm.get_response_schema_template();
    const currentPrompt = dm.get_current_prompt_for_web_send();

    logRequestTrace(traceId, 'chat_dispatch', {
      site,
      session_url: sessionUrl,
      current_prompt_length: currentPrompt.length,
    });

    const handleDispatchError = (err: unknown): boolean => {
      if (err instanceof WebDriverError) {
        if (err.code === WebDriverErrorCode.INVALID_SESSION_URL) {
          // session 失效，取消链接状态，让下次重新初始化
          dm.cancel_linked();
          res.status(422).json({
            error: {
              message: 'Session 链接无效，请重新发送请求以初始化新对话',
              type: 'invalid_request_error',
              code: 'invalid_session_url',
            },
          });
          return true;
        }
        if (err.code === WebDriverErrorCode.RESPONSE_TIMEOUT) {
          res.status(408).json({
            error: {
              message: '等待模型响应超时，请稍后重试',
              type: 'timeout_error',
              code: 'response_timeout',
            },
          });
          return true;
        }
      }
      return false;
    };

    let chatResult;
    try {
      chatResult = await webDriver.chat(site, sessionUrl, currentPrompt, {
        mode: 'chat',
        responseSchemaTemplate
      });
    } catch (err) {
      if (handleDispatchError(err)) {
        return;
      }
      throw err;
    }

    // ===== Step 7: 处理响应 —— 确保返回 JSON 格式 =====
    let responseContent = chatResult.content;
    let parsedJson = extractJson(responseContent);
    let upstreamError = detectUpstreamServiceError(responseContent);
    logRequestTrace(traceId, 'json_extract_initial', {
      content_length: responseContent.length,
      parsed_json: Boolean(parsedJson),
      upstream_error: Boolean(upstreamError),
      content_preview: buildContentPreview(responseContent),
    });
    const maxRetries = 2;
    let retryCount = 0;

    while (!parsedJson && !upstreamError && retryCount < maxRetries) {
      console.log(
        `[Controller] 模型未返回 JSON 格式，重新发送（第 ${retryCount + 1} 次）... ` +
          `preview=${responseContent.slice(0, 160).replace(/\s+/g, ' ')}`
      );

      const retryBasePrompt = dm.get_format_only_retry_prompt();
      const templatePrompt = retryBasePrompt;

      try {
        const retryResult = await webDriver.chat(site, sessionUrl, templatePrompt, {
          mode: 'retry',
        });
        responseContent = retryResult.content;
        parsedJson = extractJson(responseContent);
        upstreamError = detectUpstreamServiceError(responseContent);
        logRequestTrace(traceId, 'json_extract_retry', {
          retry_index: retryCount + 1,
          prompt_mode: 'format_only',
          content_length: responseContent.length,
          parsed_json: Boolean(parsedJson),
          upstream_error: Boolean(upstreamError),
          content_preview: buildContentPreview(responseContent),
        });
      } catch (err) {
        if (handleDispatchError(err)) {
          return;
        }
        break;
      }
      retryCount++;
    }

    if (!parsedJson && !upstreamError) {
      logRequestTrace(traceId, 'json_extract_fallback_plain_text', {
        retries: retryCount,
        content_length: responseContent.length,
        content_preview: buildContentPreview(responseContent),
      });
    }

    if (upstreamError) {
      sendUpstreamServiceError(res, upstreamError);
      logRequestTrace(traceId, 'upstream_error_detected', upstreamError as unknown as Record<string, unknown>);
      return;
    }

    // ===== Step 8: 更新 DataManager 与响应载荷（共用同一个解析对象） =====
    let parsedChoiceObj: any | null = null;
    let messagePayload: {
      content?: string | null;
      tool_calls?: any[];
      finish_reason?: string;
    } = {
      content: responseContent,
    };

    const persistAssistantCurrent = (assistantMessage: { role?: string; content?: any; tool_calls?: any[] }) => {
      dm.clear_current();
      dm.replace_current_with_assistant({
        role: 'assistant',
        content: assistantMessage.content ?? responseContent,
        tool_calls: assistantMessage.tool_calls,
      } as any);
    };

    if (parsedJson) {
      try {
        const jsonResponse = JSON.parse(parsedJson) as any;
        parsedChoiceObj = jsonResponse?.choices?.[0] ?? jsonResponse;

        if (parsedChoiceObj?.message && typeof parsedChoiceObj.message === 'object') {
          persistAssistantCurrent(parsedChoiceObj.message);
          messagePayload = {
            content: parsedChoiceObj.message.content ?? responseContent,
            tool_calls: parsedChoiceObj.message.tool_calls,
            finish_reason: parsedChoiceObj.finish_reason,
          };
        } else {
          persistAssistantCurrent({
            role: 'assistant',
            content: responseContent,
          });
        }
      } catch {
        // JSON 解析失败，回退到纯文本包装
        persistAssistantCurrent({
          role: 'assistant',
          content: responseContent,
        });
      }
    } else {
      persistAssistantCurrent({
        role: 'assistant',
        content: responseContent,
      });
    }

    await dm.save_data();
    logSessionTrace('after_save_assistant', dm, traceId);

    // ===== Step 9: 构造并返回响应 =====
    // 统一通过 protocol.format 返回 OpenAI 格式（与 DataManager 共用同源解析对象）

    const formattedResponse = protocol.format(
      internalReq.model,
      messagePayload,
      dm.get_usage().usage
    );

    logRequestTrace(traceId, 'response_ready', {
      model: internalReq.model,
      finish_reason: formattedResponse.choices?.[0]?.finish_reason,
      content_preview: formattedResponse.choices?.[0]?.message?.content?.slice?.(0, 80) ?? '',
      prompt_tokens: formattedResponse.usage?.prompt_tokens ?? 0,
      completion_tokens: formattedResponse.usage?.completion_tokens ?? 0,
      total_tokens: formattedResponse.usage?.total_tokens ?? 0,
    });
    logDebug('chat_completions_response_payload', {
      trace_id: traceId,
      response_preview: stringifyLogPayload(formattedResponse).slice(0, 5000),
    });

    const isStream = requestBody?.stream === true;

    if (isStream) {
      logRequestTrace(traceId, 'response_stream_ready', {
        model: internalReq.model,
        finish_reason: formattedResponse.choices?.[0]?.finish_reason,
      });
      sendSseStreamFromFormattedResponse(res, formattedResponse);
      return;
    }

    res.json(formattedResponse);

  } catch (err) {
    const fallbackTraceId = `req-error-${Date.now()}`;
    logRequestTrace(fallbackTraceId, 'handler_error', {
      message: err instanceof Error ? err.message : String(err),
    });
    next(err);
  }
}

/**
 * GET /v1/models — 返回支持的模型列表
 */
export async function listModelsHandler(
  _req: Request,
  res: Response
): Promise<void> {
  const providers = getNormalizedProviderConfigMap();
  const modelList = Object.values(providers)
    .flatMap((provider) => provider.models ?? [])
    .map((id: string) => ({
      id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'webclaw-proxy',
    }));

  res.json({
    object: 'list',
    data: modelList,
  });
}
