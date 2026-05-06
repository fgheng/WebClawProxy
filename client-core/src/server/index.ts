import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { createApiRouter, SessionManager } from './routes';
import { handleWebSocketConnection } from './ws-handler';

/**
 * WebClaw Agent Service — 独立 Node.js 服务
 *
 * 提供 REST API + WebSocket 供前端（Desktop/TUI）通信。
 * 工具执行完全在此进程内完成（Node.js 环境）。
 */

const DEFAULT_PORT = 8100;
const DEFAULT_PROXY_URL = 'http://localhost:3000';

export function startAgentService(options?: AgentServiceOptions): void {
  const port = options?.port ?? Number(process.env.WEBCLAW_AGENT_PORT ?? DEFAULT_PORT);
  const proxyBaseUrl = options?.proxyBaseUrl ?? process.env.WEBCLAW_PROXY_URL ?? DEFAULT_PROXY_URL;

  // 创建 SessionManager
  const sessionsManager = new SessionManager({ proxyBaseUrl });

  // Express REST API
  const app = express();
  app.use(cors());
  app.use(express.json());

  const apiRouter = createApiRouter(sessionsManager);
  app.use('/v1', apiRouter);

  // 创建 HTTP server（Express + WebSocket 共用）
  const server = createServer(app);

  // WebSocket Server（挂载在同一端口）
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    handleWebSocketConnection(ws, sessionsManager);
  });

  server.listen(port, () => {
    console.log(`[Agent Service] Started on port ${port}`);
    console.log(`[Agent Service] REST API: http://localhost:${port}/v1`);
    console.log(`[Agent Service] WebSocket: ws://localhost:${port}/ws`);
    console.log(`[Agent Service] Proxy URL: ${proxyBaseUrl}`);
  });

  // 优雅退出
  const shutdown = () => {
    console.log('[Agent Service] Shutting down...');
    wss.close();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export interface AgentServiceOptions {
  port?: number;
  proxyBaseUrl?: string;
}

// ── 直接运行入口 ──────────────────────────────────────────
// ts-node 直接执行此文件时才启动服务（被 import 时不启动）
const entryFile = process.argv[1] ?? '';
if (entryFile.includes('server/index.ts') || entryFile.includes('server/index')) {
  startAgentService();
}