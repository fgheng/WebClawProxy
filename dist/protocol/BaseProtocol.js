"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseProtocol = void 0;
/**
 * 协议转换抽象基类
 *
 * 所有协议实现必须继承该类并实现 parse 和 format 方法。
 *
 * 扩展示例：
 * ```typescript
 * class AnthropicProtocol extends BaseProtocol {
 *   parse(input: unknown): InternalRequest { ... }
 *   format(
 *     model: string,
 *     message: Pick<InternalResponse, 'content' | 'tool_calls' | 'finish_reason'>,
 *     usage?: InternalResponse['usage']
 *   ): unknown { ... }
 * }
 * ```
 */
class BaseProtocol {
}
exports.BaseProtocol = BaseProtocol;
//# sourceMappingURL=BaseProtocol.js.map