"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const openai_1 = require("./routes/openai");
/**
 * 创建并配置 Express 应用
 */
function createApp() {
    const app = (0, express_1.default)();
    // ===== 中间件 =====
    app.use(express_1.default.json({ limit: '10mb' }));
    app.use(express_1.default.urlencoded({ extended: true }));
    // 请求日志
    app.use((req, _res, next) => {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
        next();
    });
    // CORS（支持各种 AI 客户端）
    app.use((_req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        next();
    });
    // OPTIONS 预检请求处理
    app.options('*', (_req, res) => {
        res.status(200).end();
    });
    // ===== 路由 =====
    // OpenAI 兼容接口
    app.post('/v1/chat/completions', openai_1.chatCompletionsHandler);
    // 模型列表
    app.get('/v1/models', openai_1.listModelsHandler);
    // 健康检查
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
    // 404
    app.use((_req, res) => {
        res.status(404).json({
            error: {
                message: '接口不存在',
                type: 'not_found',
                code: 'not_found',
            },
        });
    });
    // ===== 全局错误处理 =====
    app.use((err, _req, res, _next) => {
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
//# sourceMappingURL=server.js.map