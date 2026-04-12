"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProtocolParseError = exports.ProtocolType = exports.OpenAIProtocol = exports.BaseProtocol = void 0;
var BaseProtocol_1 = require("./BaseProtocol");
Object.defineProperty(exports, "BaseProtocol", { enumerable: true, get: function () { return BaseProtocol_1.BaseProtocol; } });
var OpenAIProtocol_1 = require("./openai/OpenAIProtocol");
Object.defineProperty(exports, "OpenAIProtocol", { enumerable: true, get: function () { return OpenAIProtocol_1.OpenAIProtocol; } });
var types_1 = require("./types");
Object.defineProperty(exports, "ProtocolType", { enumerable: true, get: function () { return types_1.ProtocolType; } });
Object.defineProperty(exports, "ProtocolParseError", { enumerable: true, get: function () { return types_1.ProtocolParseError; } });
//# sourceMappingURL=index.js.map