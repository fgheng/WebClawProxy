import express, { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { chatCompletionsHandler, listModelsHandler } from './routes/openai';
import { logDebug, formatRequestBodyPreview } from './logger';
import { forwardMonitorBus } from './forward-monitor-bus';
import { sessionRegistry } from './session-registry';
import { getNormalizedProviderConfigMap, isSiteKey } from '../config/provider-config';
import { clearAppConfigCache, getAppConfigPath } from '../config/app-config';
import { initConversationService, getConversationService } from '../conversation/ConversationService';

/**
 * 创建并配置 Express 应用
 */
export function createApp() {
  // 初始化 ConversationService，复用 sessionRegistry 的 conversationStore
  initConversationService(sessionRegistry.getConversationStore());

  const app = express();

  // ===== 中间件 =====
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 请求日志
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const isNoisy =
      req.method === 'GET' &&
      (req.path === '/health' || req.path === '/v1/providers');
    if (!isNoisy) {
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
    }
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
          input_max_chars: typeof provider.web?.input_max_chars === 'number' ? provider.web.input_max_chars : null,
          forward_base_url: provider.forward?.base_url ?? '',
          api_key: provider.forward?.api_key ?? '',
          api_key_masked: provider.forward?.api_key ? '****' : '',
        },
      ])
    );
    res.json({ providers });
  });

  app.patch('/v1/providers/:provider', (req: Request, res: Response) => {
    const provider = String(req.params.provider ?? '').trim();
    if (!provider) {
      res.status(400).json({ error: { message: 'provider is required', code: 'invalid_provider' } });
      return;
    }
    const body = req.body as {
      models?: unknown;
      default_mode?: unknown;
      input_max_chars?: unknown;
      forward_base_url?: unknown;
      api_key?: unknown;
    };
    const configPath = getAppConfigPath();
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
      providers?: Record<string, any>;
    };
    if (!raw.providers || !raw.providers[provider]) {
      res.status(404).json({ error: { message: 'provider not found', code: 'provider_not_found' } });
      return;
    }
    const target = raw.providers[provider] as Record<string, any>;
    if (Array.isArray(body.models)) {
      target.models = body.models
        .map((item) => String(item ?? '').trim())
        .filter((item) => item.length > 0);
    }
    if (typeof body.default_mode === 'string') {
      const mode = body.default_mode.trim();
      if (mode === 'web' || mode === 'forward') {
        target.default_mode = mode;
      }
    }
    if (body.input_max_chars === null) {
      if (target.web && typeof target.web === 'object') {
        delete target.web.input_max_chars;
      }
      delete target.input_max_chars;
    } else if (typeof body.input_max_chars === 'number' && Number.isInteger(body.input_max_chars) && body.input_max_chars > 0) {
      target.web = target.web ?? {};
      target.web.input_max_chars = body.input_max_chars;
      delete target.input_max_chars;
    }
    if (typeof body.forward_base_url === 'string') {
      target.forward = target.forward ?? {};
      target.forward.base_url = body.forward_base_url.trim();
    }
    if (typeof body.api_key === 'string') {
      target.forward = target.forward ?? {};
      target.forward.api_key = body.api_key.trim();
    }
    fs.writeFileSync(configPath, JSON.stringify(raw, null, 2), 'utf-8');
    clearAppConfigCache();
    const normalized = getNormalizedProviderConfigMap()[provider];
    res.json({
      ok: true,
      provider,
      data: {
        models: normalized?.models ?? [],
        default_mode: normalized?.default_mode ?? 'web',
        site: normalized?.web?.site ?? '',
        input_max_chars: typeof normalized?.web?.input_max_chars === 'number' ? normalized.web.input_max_chars : null,
        forward_base_url: normalized?.forward?.base_url ?? '',
        api_key: normalized?.forward?.api_key ?? '',
        api_key_masked: normalized?.forward?.api_key ? '****' : '',
      },
    });
  });

  app.get('/v1/settings', (_req: Request, res: Response) => {
    const configPath = getAppConfigPath();
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
      server?: { port?: unknown };
    };
    const portNum = Number(raw?.server?.port);
    res.json({
      settings: {
        server_port: Number.isFinite(portNum) && portNum > 0 ? Math.floor(portNum) : 3000,
      },
    });
  });

  app.patch('/v1/settings', (req: Request, res: Response) => {
    const body = req.body as { server_port?: unknown };
    const nextPort = Number(body.server_port);
    if (!Number.isInteger(nextPort) || nextPort < 1 || nextPort > 65535) {
      res.status(400).json({
        error: { message: 'server_port must be an integer between 1 and 65535', code: 'invalid_server_port' },
      });
      return;
    }
    const configPath = getAppConfigPath();
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, any>;
    raw.server = raw.server ?? {};
    raw.server.port = nextPort;
    fs.writeFileSync(configPath, JSON.stringify(raw, null, 2), 'utf-8');
    clearAppConfigCache();
    res.json({ ok: true, settings: { server_port: nextPort } });
  });

  // ===== Conversations API =====

  // GET /v1/conversations — 对话快照列表，支持 ?provider= 和 ?mode= 过滤
  app.get('/v1/conversations', (req: Request, res: Response) => {
    const provider = typeof req.query.provider === 'string' ? req.query.provider : undefined;
    const mode = typeof req.query.mode === 'string' ? req.query.mode : undefined;
    const snapshots = getConversationService().listSnapshots(provider, mode);
    res.json({ conversations: snapshots });
  });

  // GET /v1/conversations/:id — 完整 ConversationRecord
  app.get('/v1/conversations/:id', (req: Request, res: Response) => {
    const record = getConversationService().findById(req.params.id);
    if (!record) {
      res.status(404).json({ error: { message: 'conversation not found', code: 'not_found' } });
      return;
    }
    res.json({ conversation: record });
  });

  // GET /v1/conversations/:id/messages — 仅返回 messages 数组
  app.get('/v1/conversations/:id/messages', (req: Request, res: Response) => {
    const record = getConversationService().findById(req.params.id);
    if (!record) {
      res.status(404).json({ error: { message: 'conversation not found', code: 'not_found' } });
      return;
    }
    res.json({ messages: record.messages });
  });

  // DELETE /v1/conversations/:id — 删除
  app.delete('/v1/conversations/:id', (req: Request, res: Response) => {
    const deleted = getConversationService().delete(req.params.id);
    res.json({ deleted });
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
