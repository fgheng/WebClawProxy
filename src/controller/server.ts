import express, { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { chatCompletionsHandler, listModelsHandler } from './routes/openai';
import { logDebug, formatRequestBodyPreview } from './logger';
import { forwardMonitorBus } from './forward-monitor-bus';
import { sessionRegistry } from './session-registry';
import { getNormalizedProviderConfigMap, isSiteKey } from '../config/provider-config';

/**
 * 创建并配置 Express 应用
 */
export function createApp() {
  const app = express();

  // ===== 中间件 =====
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 请求日志
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    logDebug('http_request', {
      method: req.method,
      path: req.path,
      query: req.query,
      headers: {
        'x-trace-id': req.headers['x-trace-id'] ?? '',
        'x-session-id': req.headers['x-session-id'] ?? '',
        authorization_present: Boolean(req.headers.authorization),
      },
      body_preview: formatRequestBodyPreview(req.body ?? {}),
    });
    next();
  });

  // CORS（支持各种 AI 客户端）
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    const requestedHeaders = req.headers['access-control-request-headers'];
    res.setHeader(
      'Access-Control-Allow-Headers',
      typeof requestedHeaders === 'string' && requestedHeaders.trim().length > 0
        ? requestedHeaders
        : 'Content-Type, Authorization, x-trace-id, x-session-id'
    );
    next();
  });

  // OPTIONS 预检请求处理
  app.options('*', (_req: Request, res: Response) => {
    res.status(200).end();
  });

  // ===== 路由 =====

  // OpenAI 兼容接口
  app.post('/v1/chat/completions', chatCompletionsHandler);

  // 模型列表
  app.get('/v1/models', listModelsHandler);

  // Provider 配置元信息（供 desktop/tui/gui 拉取）
  app.get('/v1/providers', (_req: Request, res: Response) => {
    const normalized = getNormalizedProviderConfigMap();
    const providers = Object.fromEntries(
      Object.entries(normalized).map(([providerKey, provider]) => [
        providerKey,
        {
          models: provider.models ?? [],
          default_mode: provider.default_mode ?? 'web',
          site: isSiteKey(providerKey) ? (provider.web?.site ?? '') : '',
        },
      ])
    );
    res.json({ providers });
  });

  // 健康检查
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Forward Monitor — 静态页面
  const monitorHtmlPath = path.resolve(__dirname, '../../src/static/forward-monitor.html');
  const monitorHtmlPathAlt = path.resolve(__dirname, '../static/forward-monitor.html');
  const resolvedMonitorPath = fs.existsSync(monitorHtmlPath) ? monitorHtmlPath : monitorHtmlPathAlt;
  app.get('/monitor', (_req: Request, res: Response) => {
    res.sendFile(resolvedMonitorPath);
  });

  // Forward Monitor — SSE 事件流
  app.get('/v1/forward-monitor/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 连接建立后立即推送全量 session 快照
    const snapshot = sessionRegistry.getSnapshot();
    const snapshotData = `data: ${JSON.stringify({ type: 'session-snapshot', sessions: snapshot, timestamp: Date.now() })}\n\n`;
    res.write(snapshotData);

    const removeClient = forwardMonitorBus.addClient(res);
    req.on('close', () => {
      removeClient();
    });
  });

  // Forward Monitor — REST API: 获取所有 session 列表
  app.get('/v1/forward-monitor/sessions', (req: Request, res: Response) => {
    const provider = typeof req.query.provider === 'string' ? req.query.provider : undefined;
    const sessions = sessionRegistry.getSessions(provider);
    // 返回摘要，不含完整消息体
    res.json({
      sessions: sessions.map((s) => {
        const { messages, ...rest } = s;
        return {
          ...rest,
          messageCount: messages.length,
          lastMessage: messages.length > 0 ? messages[messages.length - 1] : null,
        };
      }),
    });
  });

  // Forward Monitor — REST API: 获取单个 session 完整消息
  app.get('/v1/forward-monitor/sessions/:id', (req: Request, res: Response) => {
    const session = sessionRegistry.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: { message: 'session not found', code: 'not_found' } });
      return;
    }
    res.json({ session });
  });

  // Forward Monitor — REST API: 删除单个 session
  app.delete('/v1/forward-monitor/sessions/:id', (req: Request, res: Response) => {
    const deleted = sessionRegistry.deleteSession(req.params.id);
    res.json({ deleted });
  });

  // Forward Monitor — REST API: 获取 provider 列表
  app.get('/v1/forward-monitor/providers', (_req: Request, res: Response) => {
    res.json({ providers: sessionRegistry.getProviders() });
  });

  // 404
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        message: '接口不存在',
        type: 'not_found',
        code: 'not_found',
      },
    });
  });

  // ===== 全局错误处理 =====
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Controller] 未处理的错误:', err);
    res.status(500).json({
      error: {
        message: '内部服务错误',
        type: 'server_error',
        code: 'internal_error',
        details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
      },
    });
  });

  return app;
}
