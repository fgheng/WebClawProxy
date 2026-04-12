#!/usr/bin/env node
/**
 * WebClawProxy CLI 客户端入口
 *
 * 使用方式：
 *   npm run client                        # 默认配置（localhost:3000，gpt-4o 模型）
 *   npm run client -- --model deepseek-chat
 *   npm run client -- --url http://localhost:3000
 *   npm run client -- --model gpt-4o --system "你是一个 TypeScript 专家"
 *   npm run client -- --session-id my-client-001 --trace
 *   npm run client -- --help
 */

import { ChatCLI } from './ChatCLI';
import { ClientConfig } from './types';
import * as fs from 'fs';
import * as path from 'path';

// 解析命令行参数
const args = process.argv.slice(2);

function showHelp(): void {
  console.log(`
WebClawProxy CLI 客户端

用法：
  npm run client [-- 选项]

选项：
  --url <地址>            服务地址（默认：http://localhost:3000）
  --model <模型名>        使用的模型（默认：gpt-4o）
  --system <提示词>       系统提示词（可选）
  --timeout <秒数>        请求超时秒数（默认：180）
  --session-id <ID>       客户端会话标识（用于链路排查）
  --trace                 开启客户端链路日志（默认开启）
  --no-trace              关闭客户端链路日志
  --trace-preview <字符>  日志中响应预览字符数（默认：180）
  --help / -h            显示此帮助信息

示例：
  npm run client
  npm run client -- --model deepseek-chat
  npm run client -- --model gpt-4o --system "你是一个 Python 专家"
  npm run client -- --url http://192.168.1.100:3000 --model qwen-max
  npm run client -- --session-id debug-session-001 --trace

客户端内置命令（在对话中使用）：
  /help          显示帮助
  /model <名称>  切换模型
  /system <文本> 设置系统提示词
  /trace [on|off] 查看或开关链路日志
  /clear         清空对话历史
  /history       查看对话历史
  /config        查看当前配置
  /quit          退出
`);
}

// 检查帮助标志
if (args.includes('--help') || args.includes('-h')) {
  showHelp();
  process.exit(0);
}

// 解析参数辅助函数
function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

function buildDefaultSessionId(): string {
  const now = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `cli-${now}-${rand}`;
}

// 尝试从配置文件读取默认端口
let defaultPort = 3000;
try {
  const configPath = path.join(process.cwd(), 'config', 'default.json');
  if (fs.existsSync(configPath)) {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (cfg.server?.port) {
      defaultPort = cfg.server.port;
    }
  }
} catch {
  // 忽略配置读取失败
}

const traceEnabled = hasFlag('--no-trace') ? false : true;

const previewArg = getArg('--trace-preview');
const previewChars = previewArg ? Number(previewArg) : 180;

// 构建客户端配置
const config: ClientConfig = {
  baseUrl: getArg('--url') ?? `http://localhost:${defaultPort}`,
  model: getArg('--model') ?? 'gpt-4o',
  system: getArg('--system'),
  timeoutMs: getArg('--timeout') ? parseInt(getArg('--timeout')!, 10) * 1000 : 180000,
  sessionId: getArg('--session-id') ?? buildDefaultSessionId(),
  traceEnabled,
  tracePreviewChars: Number.isFinite(previewChars) && previewChars > 0 ? previewChars : 180,
};

// 启动 CLI
const cli = new ChatCLI(config);
cli.start().catch((err) => {
  console.error('客户端启动失败:', err);
  process.exit(1);
});
