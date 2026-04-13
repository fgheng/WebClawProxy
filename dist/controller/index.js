"use strict";
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
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const server_1 = require("./server");
const openai_1 = require("./routes/openai");
const logger_1 = require("./logger");
// 加载配置
const configPath = path.join(process.cwd(), 'config', 'default.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const PORT = process.env.PORT ? parseInt(process.env.PORT) : (config.server?.port ?? 3000);
(0, logger_1.initServiceLogger)();
const app = (0, server_1.createApp)();
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
                await (0, openai_1.openConfiguredWebDriverSites)();
                console.log('[Startup] 已自动打开所有配置站点页面');
            }
            catch (err) {
                console.warn('[Startup] 自动打开配置站点失败：', err instanceof Error ? err.message : err);
            }
        }
        else {
            console.log('[Startup] 已跳过自动打开站点（startup_open_sites_enabled=false）');
        }
        if (!startupPreflightEnabled) {
            console.log('[Startup] 已跳过站点登录预检（startup_preflight_enabled=false）');
            return;
        }
        try {
            await (0, openai_1.preflightWebDriverSites)();
            console.log('[Startup] 站点登录预检完成');
        }
        catch (err) {
            console.warn('[Startup] 站点登录预检失败，请按提示在浏览器登录：', err instanceof Error ? err.message : err);
        }
    })();
});
let isShuttingDown = false;
async function gracefulShutdown(signal) {
    if (isShuttingDown)
        return;
    isShuttingDown = true;
    console.log(`\n[Shutdown] 收到 ${signal}，正在关闭服务与浏览器资源...`);
    try {
        await (0, openai_1.closeWebDriver)();
        console.log('[Shutdown] 浏览器资源已关闭');
    }
    catch (err) {
        console.warn('[Shutdown] 关闭浏览器资源失败：', err instanceof Error ? err.message : err);
    }
    await new Promise((resolve) => {
        server.close((err) => {
            if (err) {
                console.warn('[Shutdown] 关闭 HTTP 服务失败：', err.message);
            }
            else {
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
exports.default = app;
//# sourceMappingURL=index.js.map