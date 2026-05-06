import { Tool } from '../../types';

/**
 * 工具模块通用导出格式
 * - definition: OpenAI function schema（给模型看）
 * - execute: 实际执行逻辑（ToolExecutor 调用）
 */
export interface ToolModule {
  definition: Tool;
  execute: (args: Record<string, unknown>) => Promise<string>;
}