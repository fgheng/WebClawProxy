import { ToolExecutor } from '../types';

/**
 * 浏览器环境下的 ToolExecutor
 *
 * 在新架构下，工具执行完全在 Agent Service（独立 Node.js 进程）中完成。
 * BrowserToolExecutor 作为备用方案，通过 HTTP 调用 Agent Service 的 API 执行工具。
 *
 * 注意：在正常使用中，前端（WebClawPanel）直接与 Agent Service 通信，
 * 不需要通过 BrowserToolExecutor。此类仅用于需要 ToolExecutor 接口
 * 但运行在浏览器环境中的特殊场景。
 */
export class BrowserToolExecutor implements ToolExecutor {
  private agentUrl: string;

  constructor(agentUrl?: string) {
    this.agentUrl = agentUrl ?? 'http://localhost:8100';
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
    // 在新架构下，浏览器不应直接执行工具
    // 工具执行由 Agent Service 处理
    return JSON.stringify({
      error: `Tool execution should go through Agent Service. Direct browser execution is not supported. Use AgentClient.chat() to send messages with tool support.`,
    });
  }
}