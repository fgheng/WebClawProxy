import express, { Request, Response, NextFunction } from 'express';
import { chatCompletionsHandler, listModelsHandler } from './routes/openai';
import { logDebug, formatRequestBodyPreview } from './logger';

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

  // 健康检查
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
