import { Request, Response, NextFunction } from 'express';
export declare function preflightWebDriverSites(): Promise<void>;
export declare function openConfiguredWebDriverSites(): Promise<void>;
export declare function closeWebDriver(): Promise<void>;
/**
 * POST /v1/chat/completions — OpenAI 兼容接口处理器
 */
export declare function chatCompletionsHandler(req: Request, res: Response, next: NextFunction): Promise<void>;
/**
 * GET /v1/models — 返回支持的模型列表
 */
export declare function listModelsHandler(_req: Request, res: Response): Promise<void>;
//# sourceMappingURL=openai.d.ts.map