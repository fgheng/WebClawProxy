import { InternalRequest, InternalResponse } from './types';

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
export abstract class BaseProtocol {
  /**
   * 将前端协议输入转换为内部统一请求结构
   * @param input 前端协议的原始 JSON 对象
   * @returns 内部统一请求结构
   */
  abstract parse(input: unknown): InternalRequest;

  /**
   * 将内部响应字段转换为对应前端协议的输出格式
   * @param model 模型名称
   * @param message 消息体（content/tool_calls/finish_reason）
   * @param usage usage 信息（可选）
   * @returns 前端协议格式的响应
   */
  abstract format(
    model: string,
    message: Pick<InternalResponse, 'content' | 'tool_calls' | 'finish_reason'>,
    usage?: InternalResponse['usage']
  ): unknown;
}
