#!/usr/bin/env node
/**
 * WebClawProxy TUI 客户端入口（服务模式）
 *
 * TUI 不再直连 WebClawProxy，而是通过 Agent Service 通信。
 *
 * 使用方式：
 *   npm run client                        # 默认配置（localhost:8100，gpt-4o 模型）
 *   npm run client -- --model deepseek-chat
 *   npm run client -- --agent-url http://localhost:8100
 *   npm run client -- --help
 */

import { ChatCLI } from './ChatCLI';

const DEFAULT_AGENT_PORT = 8100;

// 解析命令行参数
const args = process.argv.slice(2);

function showHelp(): void {
  console.log(`
WebClawProxy TUI 客户端（服务模式）

用法：
  npm run client [-- 选项]

选项：
  --agent-url <地址>     Agent Service 地址（默认：http://localhost:8100）
  --model <模型名>       使用的模型（默认：gpt-4o）
  --mode <web|forward>   请求模式（默认：web）
  --help / -h            显示此帮助信息

说明：
  TUI 通过 Agent Service（独立 Node.js 进程）与模型通信。
  工具调用由 Agent Service 自动执行，无需本地 Node.js 环境。

  请先启动 Agent Service：
    npm run agent-service

客户端内置命令（在对话中使用）：
  /help          显示帮助
  /model <名称>  切换模型
  /mode <web|forward> 切换模式
  /clear         清空对话
  /new           新建会话
  /config        查看当前配置
  /tools         查看可用工具
  /quit          退出
`);
}

if (args.includes('--help') || args.includes('-h')) {
  showHelp();
  process.exit(0);
}

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

const agentUrl = getArg('--agent-url') ?? `http://localhost:${DEFAULT_AGENT_PORT}`;
const model = getArg('--model') ?? 'gpt-4o';
const mode = getArg('--mode') ?? 'web';

const cli = new ChatCLI({ agentUrl, model, mode });
cli.start().catch((err) => {
  console.error('TUI 启动失败:', err);
  process.exit(1);
});