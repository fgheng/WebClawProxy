import { ContentItem } from '../types';

/**
 * OpenAI API 请求格式的消息结构
 */
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | string;
  content: string | ContentItem[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: {
    index?: number;
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }[];
}

/**
 * OpenAI API 完整请求格式
 */
export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  store?: boolean;
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  n?: number;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  tools?: {
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    };
  }[];
  tool_choice?: string | object;
  parallel_tool_calls?: boolean;
  response_format?: { type: string };
  seed?: number;
  user?: string;
}

/**
 * OpenAI API 响应格式
 */
export interface OpenAIResponse {
  id: string;
  object: 'chat.completion' | 'chat.completion.chunk';
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: object[];
    };
    logprobs: null;
    finish_reason: string;
  }[];
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
  system_fingerprint?: string;
}
