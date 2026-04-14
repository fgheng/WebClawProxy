import { createApp } from './server';
import { preflightWebDriverSites, openConfiguredWebDriverSites, closeWebDriver } from './routes/openai';
import { initServiceLogger } from './logger';
import { loadAppConfig } from '../config/app-config';

// 加载配置
const config = loadAppConfig();

const PORT = process.env.PORT ? parseInt(process.env.PORT) : (config.server?.port ?? 3000);

initServiceLogger();

const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║         WebClawProxy 服务已启动           ║
╠══════════════════════════════════════════╣
║  地址: http://localhost:${PORT.toString().padEnd(16)}   ║
║                                          ║
║  支持的接口：                             ║
║  POST /v1/chat/completions               ║
║  GET  /v1/models                         ║
║  GET  /health                            ║
╚══════════════════════════════════════════╝
  `);

  const startupOpenSitesEnabled = config.webdriver?.startup_open_sites_enabled === true;
  const startupPreflightEnabled = config.webdriver?.startup_preflight_enabled !== false;

  // 启动任务在后台串行执行，避免 open/preflight 并发导致同站点重复开页
  void (async () => {
    if (startupOpenSitesEnabled) {
      try {
        await openConfiguredWebDriverSites();
        console.log('[Startup] 已自动打开所有配置站点页面');
      } catch (err) {
        console.warn('[Startup] 自动打开配置站点失败：', err instanceof Error ? err.message : err);
      }
    } else {
      console.log('[Startup] 已跳过自动打开站点（startup_open_sites_enabled=false）');
    }

    if (!startupPreflightEnabled) {
      console.log('[Startup] 已跳过站点登录预检（startup_preflight_enabled=false）');
      return;
    }

    try {
      await preflightWebDriverSites();
      console.log('[Startup] 站点登录预检完成');
    } catch (err) {
      console.warn('[Startup] 站点登录预检失败，请按提示在浏览器登录：', err instanceof Error ? err.message : err);
    }
  })();
});

let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[Shutdown] 收到 ${signal}，正在关闭服务与浏览器资源...`);

  try {
    await closeWebDriver();
    console.log('[Shutdown] 浏览器资源已关闭');
  } catch (err) {
    console.warn('[Shutdown] 关闭浏览器资源失败：', err instanceof Error ? err.message : err);
  }

  await new Promise<void>((resolve) => {
    server.close((err?: Error) => {
      if (err) {
        console.warn('[Shutdown] 关闭 HTTP 服务失败：', err.message);
      } else {
        console.log('[Shutdown] HTTP 服务已关闭');
      }
      resolve();
    });

    setTimeout(() => resolve(), 3000);
  });

  process.exit(0);
}

process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});

export default app;
