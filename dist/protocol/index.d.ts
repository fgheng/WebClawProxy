/**
 * 协议转换模块入口
 *
 * 对外暴露：
 * - OpenAIProtocol: OpenAI 协议转换器
 * - BaseProtocol: 抽象基类（用于自定义新协议）
 * - 类型定义: InternalRequest, InternalResponse, Message, Tool 等
 *
 * 使用示例：
 * ```typescript
 * import { OpenAIProtocol } from './src/protocol';
 *
 * const protocol = new OpenAIProtocol();
 *
 * // 解析 OpenAI 请求
 * const internalReq = protocol.parse(openAIJsonBody);
 * console.log(internalReq.model);    // "gpt-4o"
 * console.log(internalReq.system);   // "You are a helpful assistant"
 * console.log(internalReq.history);  // [...历史消息]
 * console.log(internalReq.current);  // {role:"user", content:[...]}
 *
 * // 格式化响应
 * const openAIResp = protocol.format(
 *   "gpt-4o",
 *   { content: "你好！" },
 *   { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
 * );
 * ```
 */
export { BaseProtocol } from './BaseProtocol';
export { OpenAIProtocol } from './openai/OpenAIProtocol';
export { InternalRequest, InternalResponse, Message, ContentItem, Tool, ToolFunction, ToolParameters, ToolCall, ProtocolType, ProtocolParseError, } from './types';
export { OpenAIRequest, OpenAIResponse, OpenAIMessage } from './openai/types';
//# sourceMappingURL=index.d.ts.map