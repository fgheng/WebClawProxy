import * as path from 'path';
import * as fs from 'fs';
import { createApp } from './server';

// 加载配置
const configPath = path.join(process.cwd(), 'config', 'default.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const PORT = process.env.PORT ? parseInt(process.env.PORT) : (config.server?.port ?? 3000);

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
});

export default app;
