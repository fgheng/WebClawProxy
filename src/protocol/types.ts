/**
 * 内容项类型 — 对应 OpenAI content 数组中的单个元素
 */
export interface ContentItem {
  type: 'text' | 'file' | 'image_url' | 'image' | string;
  text?: string;
  file?: string;
  image_url?: string | { url: string; detail?: string };
  [key: string]: unknown;
}

/**
 * 消息结构 — 对话历史/当前消息的统一格式
 */
export interface Message {
  role: string;
  content: string | ContentItem[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

/**
 * 工具参数属性
 */
export interface ToolParameterProperty {
  type?: string;
  description?: string;
  enum?: string[];
  [key: string]: unknown;
}

/**
 * 工具参数
 */
export interface ToolParameters {
  type?: string;
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * 工具函数定义
 */
export interface ToolFunction {
  name: string;
  description?: string;
  parameters?: ToolParameters;
}

/**
 * 工具 — 与 OpenAI tools 格式兼容
 */
export interface Tool {
  type: 'function' | string;
  function: ToolFunction;
}

/**
 * 内部统一请求结构
 * 无论前端使用哪种协议（OpenAI/Anthropic/Gemini），均转换为此结构
 */
export interface InternalRequest {
  /** 模型名称，如 gpt-4o、deepseek-chat */
  model: string;
  /** 系统提示词，可为空字符串 */
  system: string;
  /** 对话历史（不含当前消息，不含 system 消息） */
  history: Message[];
  /** 可用工具列表 */
  tools: Tool[];
  /** 当前待发送消息批次（仅 user/tool） */
  current: Message[];
}

/**
 * 内部返回结构（暂时保留接口）
 */
export interface InternalResponse {
  content?: string | null;
  tool_calls?: ToolCall[];
  finish_reason?: string;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * 工具调用结果
 */
export interface ToolCall {
  index?: number;
  id?: string;
  type?: 'function';
  function?: {
    name: string;
    arguments: string;
  };
}

/**
 * 协议类型枚举
 */
export enum ProtocolType {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GEMINI = 'gemini',
  LLAMA = 'llama',
}

/**
 * 协议解析错误
 */
export class ProtocolParseError extends Error {
  constructor(
    public readonly protocol: ProtocolType | string,
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ProtocolParseError';
  }
}
