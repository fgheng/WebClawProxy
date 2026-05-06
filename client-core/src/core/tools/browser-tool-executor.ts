import { ToolExecutor } from '../types';

/**
 * 浏览器环境下的 ToolExecutor
 * 通过 IPC 调用 Electron 主进程执行工具（主进程是 Node.js 环境）
 *
 * 使用方式：
 *   const executor = new BrowserToolExecutor();
 *   const result = await executor.execute('list_directory', { path: '~/Downloads' });
 */
export class BrowserToolExecutor implements ToolExecutor {
  async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
    // 通过 window.webclawDesktop IPC 调主进程执行
    if (typeof window !== 'undefined' && window.webclawDesktop?.executeTool) {
      try {
        const result = await window.webclawDesktop.executeTool(toolName, args);
        return result;
      } catch (err: any) {
        return JSON.stringify({ error: `IPC execution failed: ${err.message ?? String(err)}` });
      }
    }

    // fallback：如果不在 Electron 环境中，返回错误提示
    return JSON.stringify({
      error: `Tool "${toolName}" requires Node.js environment. Current environment is browser. Please run in Electron desktop app or use TUI mode.`,
    });
  }
}