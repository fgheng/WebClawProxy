#!/usr/bin/env node
"use strict";
/**
 * WebClawProxy CLI 客户端入口
 *
 * 使用方式：
 *   npm run client                        # 默认配置（localhost:3000，gpt-4o 模型）
 *   npm run client -- --model deepseek-chat
 *   npm run client -- --url http://localhost:3000
 *   npm run client -- --model gpt-4o --system-file ./prompts/system.txt --tools-file ./prompts/tools.json
 *   npm run client -- --session-id my-client-001 --trace
 *   npm run client -- --help
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const ChatCLI_1 = require("./ChatCLI");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const app_config_1 = require("../config/app-config");
// 解析命令行参数
const args = process.argv.slice(2);
function showHelp() {
    console.log(`
WebClawProxy CLI 客户端

用法：
  npm run client [-- 选项]

选项：
  --url <地址>            服务地址（默认：http://localhost:3000）
  --model <模型名>        使用的模型（默认：gpt-4o）
  --stream                开启流式请求（SSE）
  --no-stream             关闭流式请求（默认）
  --system-file <路径>    系统提示词文件（文本文件，内容为字符串）
  --tools-file <路径>     工具定义文件（JSON，格式：{"tools": []}）
  --timeout <秒数>        请求超时秒数（默认：180）
  --session-id <ID>       客户端会话标识（用于链路排查）
  --trace                 开启客户端链路日志（默认开启）
  --no-trace              关闭客户端链路日志
  --trace-preview <字符>  日志中响应预览字符数（默认：180）
  --help / -h            显示此帮助信息

示例：
  npm run client
  npm run client -- --model deepseek-chat
  npm run client -- --stream --model gpt-4o --system-file ./prompts/system.txt --tools-file ./prompts/tools.json
  npm run client -- --url http://192.168.1.100:3000 --model qwen-max
  npm run client -- --session-id debug-session-001 --trace

客户端内置命令（在对话中使用）：
  /help          显示帮助
  /model <名称>  切换模型
  /provider <名称> 切换 provider
  /system <文本> 设置系统提示词
  /trace [on|off] 查看或开关链路日志
  /stream [on|off] 查看或开关流式请求
  /clear         清空对话历史
  /new           新建本地对话上下文
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
function getArg(flag) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length) {
        return args[idx + 1];
    }
    return undefined;
}
function hasFlag(flag) {
    return args.includes(flag);
}
function readSystemPromptFromFile(filePath) {
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    if (!fs.existsSync(absPath)) {
        throw new Error(`系统提示词文件不存在: ${absPath}`);
    }
    return fs.readFileSync(absPath, 'utf-8');
}
function readToolsFromFile(filePath) {
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    if (!fs.existsSync(absPath)) {
        throw new Error(`工具文件不存在: ${absPath}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
    }
    catch (err) {
        throw new Error(`工具文件不是合法 JSON: ${absPath}，${err instanceof Error ? err.message : String(err)}`);
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tools)) {
        throw new Error(`工具文件格式错误: ${absPath}，要求格式为 {"tools": []}`);
    }
    return parsed.tools;
}
function buildDefaultSessionId() {
    const now = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    return `cli-${now}-${rand}`;
}
// 尝试从配置文件读取默认端口
let defaultPort = 3000;
try {
    const cfg = (0, app_config_1.loadAppConfig)();
    if (cfg.server?.port) {
        defaultPort = cfg.server.port;
    }
}
catch {
    // 忽略配置读取失败
}
const traceEnabled = hasFlag('--no-trace') ? false : true;
const streamEnabled = hasFlag('--stream') ? true : false;
const previewArg = getArg('--trace-preview');
const previewChars = previewArg ? Number(previewArg) : 180;
const systemFilePath = getArg('--system-file');
const toolsFilePath = getArg('--tools-file');
if (getArg('--system')) {
    console.error('参数 --system 已废弃，请改用 --system-file <路径>');
    process.exit(1);
}
const systemPrompt = systemFilePath ? readSystemPromptFromFile(systemFilePath) : undefined;
const tools = toolsFilePath ? readToolsFromFile(toolsFilePath) : undefined;
// 构建客户端配置
const config = {
    baseUrl: getArg('--url') ?? `http://localhost:${defaultPort}`,
    model: getArg('--model') ?? 'gpt-4o',
    system: systemPrompt,
    tools,
    timeoutMs: getArg('--timeout') ? parseInt(getArg('--timeout'), 10) * 1000 : 180000,
    sessionId: getArg('--session-id') ?? buildDefaultSessionId(),
    traceEnabled,
    stream: streamEnabled,
    tracePreviewChars: Number.isFinite(previewChars) && previewChars > 0 ? previewChars : 180,
};
// 启动 CLI
const cli = new ChatCLI_1.ChatCLI(config);
cli.start().catch((err) => {
    console.error('客户端启动失败:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map