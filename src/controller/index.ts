import * as path from 'path';
import * as fs from 'fs';
import { createApp } from './server';
import { preflightWebDriverSites } from './routes/openai';
import { initServiceLogger } from './logger';

// 加载配置
const configPath = path.join(process.cwd(), 'config', 'default.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const PORT = process.env.PORT ? parseInt(process.env.PORT) : (config.server?.port ?? 3000);

initServiceLogger();

const app = createApp();

app.listen(PORT, () => {
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

  // 启动后先执行站点登录预检（不阻塞服务端口监听）
  void preflightWebDriverSites()
    .then(() => {
      console.log('[Startup] 站点登录预检完成');
    })
    .catch((err) => {
      console.warn('[Startup] 站点登录预检失败，请按提示在浏览器登录：', err instanceof Error ? err.message : err);
    });
});

export default app;
