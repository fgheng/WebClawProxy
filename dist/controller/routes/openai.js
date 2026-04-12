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
exports.preflightWebDriverSites = preflightWebDriverSites;
exports.chatCompletionsHandler = chatCompletionsHandler;
exports.listModelsHandler = listModelsHandler;
const protocol_1 = require("../../protocol");
const DataManager_1 = require("../../data-manager/DataManager");
const WebDriverManager_1 = require("../../web-driver/WebDriverManager");
const types_1 = require("../../web-driver/types");
const types_2 = require("../../protocol/types");
const logger_1 = require("../logger");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// 加载配置
const configPath = path.join(process.cwd(), 'config', 'default.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const protocol = new protocol_1.OpenAIProtocol();
const webDriver = new WebDriverManager_1.WebDriverManager();
async function preflightWebDriverSites() {
    const siteKeys = Object.keys(config.sites ?? {});
    if (siteKeys.length === 0)
        return;
    await webDriver.preflightConfiguredSites(siteKeys);
}
/**
 * 根据模型名称推断使用哪个网站
 * 优先查找配置文件中的 models 映射，再根据大类选择 site
 */
function inferSiteFromModel(model) {
    const models = config.models ?? {};
    for (const [category, modelList] of Object.entries(models)) {
        if (modelList.some((m) => m.toLowerCase() === model.toLowerCase())) {
            const cat = category.toLowerCase();
            // 大类到 SiteKey 的映射
            if (cat === 'gpt')
                return 'gpt';
            if (cat === 'deepseek')
                return 'deepseek';
            if (cat === 'qwen')
                return 'qwen';
            if (cat === 'kimi')
                return 'kimi';
        }
    }
    // 模糊匹配
    const lower = model.toLowerCase();
    if (lower.startsWith('gpt') || lower.startsWith('o1') || lower.startsWith('o3'))
        return 'gpt';
    if (lower.startsWith('deepseek'))
        return 'deepseek';
    if (lower.startsWith('qwen'))
        return 'qwen';
    if (lower.startsWith('moonshot') || lower.startsWith('kimi'))
        return 'kimi';
    // 默认使用 gpt
    return 'gpt';
}
/**
 * 尝试将“看起来像 JSON”的文本规范化为严格 JSON 字符串
 * 支持：
 * - ```json code fence
 * - JSONC 风格注释（行注释与块注释）
 * - 末尾多余逗号
 */
function normalizeJsonLike(input) {
    const trimmed = input.trim();
    if (!trimmed)
        return null;
    const normalizedInput = repairMalformedToolCallArguments(normalizeJsonArtifacts(trimmed));
    // 先尝试严格 JSON
    try {
        const obj = JSON.parse(normalizedInput);
        return JSON.stringify(obj);
    }
    catch {
        // ignore
    }
    // 去注释 + 去末尾逗号，再尝试
    const noComments = stripJsonComments(normalizedInput);
    const noTrailingComma = stripTrailingCommas(noComments);
    try {
        const obj = JSON.parse(noTrailingComma);
        return JSON.stringify(obj);
    }
    catch {
        return null;
    }
}
function repairMalformedToolCallArguments(text) {
    // 兼容部分模型输出："arguments": "{"path":"downloads/player.txt"}"
    // 这种写法内部引号未转义，属于非法 JSON；这里做定向修复。
    return text.replace(/("arguments"\s*:\s*)"\{([\s\S]*?)\}"/g, (_all, prefix, inner) => {
        // 已经是合法转义（如 {\"path\":\"a\"}）时不再二次处理
        if (/\\"/.test(inner)) {
            return _all;
        }
        const raw = `{${inner}}`;
        const escaped = raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return `${prefix}"${escaped}"`;
    });
}
/**
 * 清理常见网页渲染噪声，提升 JSON 识别稳定性
 */
function normalizeJsonArtifacts(text) {
    const noBomAndInvisible = text
        .replace(/^\uFEFF/, '')
        .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
        .replace(/[\u00A0\u202F]/g, ' ');
    // 兼容“代码块行号”场景（如: "12  \"key\": \"value\"")
    const withoutLineNumbers = noBomAndInvisible
        .split('\n')
        .map((line) => line.replace(/^\s*\d+\s+(?=[\[{\]}",\-\w])/, ''))
        .join('\n');
    // 清理常见代码块噪声行（不影响 JSON 字符串内容）
    const withoutUiNoise = withoutLineNumbers
        .split('\n')
        .filter((line) => !/^\s*(copy code|复制代码|jsonc?|javascript|js|typescript|ts)\s*$/i.test(line.trim()))
        .join('\n');
    // 统一常见全角标点/引号（部分站点 markdown 渲染会出现）
    return withoutUiNoise
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/，/g, ',')
        .replace(/：/g, ':')
        .replace(/｛/g, '{')
        .replace(/｝/g, '}')
        .replace(/［/g, '[')
        .replace(/］/g, ']');
}
/**
 * 移除 JSONC 注释（保留字符串内部内容）
 */
function stripJsonComments(text) {
    let result = '';
    let inString = false;
    let quoteChar = '';
    let escape = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = i + 1 < text.length ? text[i + 1] : '';
        if (inString) {
            result += ch;
            if (escape) {
                escape = false;
            }
            else if (ch === '\\') {
                escape = true;
            }
            else if (ch === quoteChar) {
                inString = false;
                quoteChar = '';
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            inString = true;
            quoteChar = ch;
            result += ch;
            continue;
        }
        // 行注释 // ...
        if (ch === '/' && next === '/') {
            i += 2;
            while (i < text.length && text[i] !== '\n')
                i++;
            if (i < text.length)
                result += '\n';
            continue;
        }
        // 块注释 /* ... */
        if (ch === '/' && next === '*') {
            i += 2;
            while (i + 1 < text.length && !(text[i] === '*' && text[i + 1] === '/'))
                i++;
            i++; // 跳过 '/'
            continue;
        }
        result += ch;
    }
    return result;
}
/**
 * 移除对象/数组中的末尾逗号（保留字符串内部内容）
 */
function stripTrailingCommas(text) {
    let result = '';
    let inString = false;
    let quoteChar = '';
    let escape = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            result += ch;
            if (escape) {
                escape = false;
            }
            else if (ch === '\\') {
                escape = true;
            }
            else if (ch === quoteChar) {
                inString = false;
                quoteChar = '';
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            inString = true;
            quoteChar = ch;
            result += ch;
            continue;
        }
        if (ch === ',') {
            // 观察后续非空白字符，若是 ] 或 } 则忽略该逗号
            let j = i + 1;
            while (j < text.length && /\s/.test(text[j]))
                j++;
            if (j < text.length && (text[j] === ']' || text[j] === '}')) {
                continue;
            }
        }
        result += ch;
    }
    return result;
}
/**
 * 从文本中提取所有平衡的 JSON 块（对象或数组）
 */
function extractBalancedJsonLikeBlocks(content) {
    const blocks = [];
    for (let start = 0; start < content.length; start++) {
        if (content[start] !== '{' && content[start] !== '[')
            continue;
        const stack = [];
        let inString = false;
        let quoteChar = '';
        let escape = false;
        for (let i = start; i < content.length; i++) {
            const ch = content[i];
            if (inString) {
                if (escape) {
                    escape = false;
                }
                else if (ch === '\\') {
                    escape = true;
                }
                else if (ch === quoteChar) {
                    inString = false;
                    quoteChar = '';
                }
                continue;
            }
            if (ch === '"' || ch === "'") {
                inString = true;
                quoteChar = ch;
                continue;
            }
            if (ch === '{' || ch === '[') {
                stack.push(ch);
                continue;
            }
            if (ch === '}' || ch === ']') {
                const top = stack[stack.length - 1];
                if ((ch === '}' && top === '{') || (ch === ']' && top === '[')) {
                    stack.pop();
                    if (stack.length === 0) {
                        blocks.push(content.slice(start, i + 1));
                        start = i;
                        break;
                    }
                }
            }
        }
    }
    return blocks;
}
/**
 * 从模型输出中提取 JSON（处理 markdown 代码块、JSONC 注释等情况）
 * 返回值为“严格 JSON 字符串”（可直接 JSON.parse）
 */
function extractJson(content) {
    const candidates = [];
    // 1) 整体内容
    candidates.push(content);
    // 2) code fence（可能多个，语言标记不限）
    const codeBlocks = content.match(/```[^\n`]*\s*\n?([\s\S]*?)\n?```/g) || [];
    for (const block of codeBlocks) {
        const m = block.match(/```[^\n`]*\s*\n?([\s\S]*?)\n?```/);
        if (m?.[1])
            candidates.push(m[1]);
    }
    // 3) 所有平衡 JSON 块（避免只取第一个导致误判）
    candidates.push(...extractBalancedJsonLikeBlocks(content));
    const seen = new Set();
    for (const candidate of candidates) {
        const key = candidate.trim();
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        const normalized = normalizeJsonLike(candidate);
        if (normalized)
            return normalized;
    }
    return null;
}
/**
 * 从上游模型的纯文本回复中识别服务错误
 * 例如额度耗尽、服务繁忙、稍后重试等情况。
 */
function detectUpstreamServiceError(content) {
    const normalized = content.replace(/\s+/g, ' ').trim();
    if (!normalized)
        return null;
    const quotaPatterns = [
        /已达到使用额度上限/i,
        /usage limit/i,
        /quota exceeded/i,
        /rate limit/i,
        /credits? exhausted/i,
        /too many requests/i,
    ];
    if (quotaPatterns.some((pattern) => pattern.test(normalized))) {
        return {
            status: 429,
            type: 'rate_limit_error',
            code: 'quota_exceeded',
            message: normalized,
        };
    }
    const servicePatterns = [
        /service unavailable/i,
        /temporarily unavailable/i,
        /try again later/i,
        /server error/i,
        /internal server error/i,
        /服务端错误/i,
        /服务不可用/i,
        /服务繁忙/i,
        /稍后再试/i,
        /overloaded/i,
    ];
    if (servicePatterns.some((pattern) => pattern.test(normalized))) {
        return {
            status: 503,
            type: 'service_unavailable',
            code: 'upstream_service_error',
            message: normalized,
        };
    }
    return null;
}
/**
 * 发送结构化错误响应
 */
function sendUpstreamServiceError(res, upstreamError) {
    res.status(upstreamError.status).json({
        error: {
            message: upstreamError.message,
            type: upstreamError.type,
            code: upstreamError.code,
        },
    });
}
function getContextSwitchConfig() {
    const raw = config.context_switch ?? {};
    return {
        enabled: Boolean(raw.enabled),
        max_prompt_tokens: typeof raw.max_prompt_tokens === 'number' ? raw.max_prompt_tokens : undefined,
        max_total_tokens: typeof raw.max_total_tokens === 'number' ? raw.max_total_tokens : undefined,
    };
}
function shouldSwitchContextByUsage(dm) {
    const switchConfig = getContextSwitchConfig();
    if (!switchConfig.enabled)
        return false;
    const usage = dm.get_usage()?.usage;
    if (!usage)
        return false;
    const exceedPrompt = typeof switchConfig.max_prompt_tokens === 'number' &&
        switchConfig.max_prompt_tokens > 0 &&
        usage.prompt_tokens >= switchConfig.max_prompt_tokens;
    const exceedTotal = typeof switchConfig.max_total_tokens === 'number' &&
        switchConfig.max_total_tokens > 0 &&
        usage.total_tokens >= switchConfig.max_total_tokens;
    return exceedPrompt || exceedTotal;
}
function logSessionTrace(stage, dm, traceId) {
    const debug = dm.get_session_debug_info();
    const prefix = traceId ? `[SessionTrace][${traceId}]` : '[SessionTrace]';
    console.log(`${prefix} stage=${stage} hash=${debug.hash_key} linked=${debug.linked} ` +
        `url_count=${debug.web_url_count} session_dir=${debug.session_dir} data_path=${debug.data_path} ` +
        `latest_url=${debug.latest_web_url || '-'}`);
}
function buildRequestTraceId(req) {
    const fromHeader = req.headers['x-trace-id']?.trim();
    if (fromHeader)
        return fromHeader;
    const now = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    return `req-${now}-${rand}`;
}
function logRequestTrace(traceId, stage, payload) {
    try {
        console.log(`[RequestTrace][${traceId}] stage=${stage} payload=${JSON.stringify(payload)}`);
    }
    catch {
        console.log(`[RequestTrace][${traceId}] stage=${stage} payload=[unserializable]`);
    }
}
/**
 * POST /v1/chat/completions — OpenAI 兼容接口处理器
 */
async function chatCompletionsHandler(req, res, next) {
    try {
        const traceId = buildRequestTraceId(req);
        const requestBody = req.body;
        const messageCount = Array.isArray(requestBody?.messages) ? requestBody.messages.length : 0;
        logRequestTrace(traceId, 'request_received', {
            method: req.method,
            path: req.path,
            model: requestBody?.model,
            message_count: messageCount,
            cookie_present: Boolean(req.headers.cookie),
            authorization_present: Boolean(req.headers.authorization),
            user_agent: req.headers['user-agent'] ?? '',
            x_forwarded_for: req.headers['x-forwarded-for'] ?? '',
            remote_ip: req.ip,
            session_header: req.headers['x-session-id'] ?? '',
        });
        (0, logger_1.logDebug)('chat_completions_request_body', {
            trace_id: traceId,
            body_preview: JSON.stringify(requestBody ?? {}).slice(0, 5000),
        });
        // ===== Step 1: 解析协议 =====
        let internalReq;
        try {
            internalReq = protocol.parse(req.body, { traceId, source: 'chatCompletionsHandler' });
        }
        catch (err) {
            if (err instanceof types_2.ProtocolParseError) {
                res.status(400).json({
                    error: {
                        message: `请求格式错误: ${err.message}`,
                        type: 'invalid_request_error',
                        code: 'invalid_request',
                    },
                });
                return;
            }
            throw err;
        }
        // ===== Step 2: 初始化 DataManager =====
        const dm = new DataManager_1.DataManager(internalReq);
        dm.set_trace_id(traceId);
        logSessionTrace('init_dm', dm, traceId);
        const initPrompt = dm.get_init_prompt_for_new_session();
        // ===== Step 3: 保存数据 =====
        await dm.save_data();
        logSessionTrace('after_save_request', dm, traceId);
        // ===== Step 4: 推断目标网站 =====
        const site = inferSiteFromModel(internalReq.model);
        // ===== Step 5: 判断链接状态，初始化或获取 session URL =====
        let sessionUrl;
        const initializeConversationAndBind = async () => {
            logSessionTrace('before_init_conversation', dm, traceId);
            let initResult;
            try {
                initResult = await webDriver.initConversation(site, initPrompt);
            }
            catch (err) {
                if (err instanceof types_1.WebDriverError) {
                    if (err.code === types_1.WebDriverErrorCode.NOT_LOGGED_IN) {
                        res.status(401).json({
                            error: {
                                message: '用户未登录，请打开浏览器完成登录',
                                type: 'authentication_error',
                                code: 'not_logged_in',
                            },
                        });
                        throw err;
                    }
                    if (err.code === types_1.WebDriverErrorCode.DIALOG_BLOCKED) {
                        res.status(503).json({
                            error: {
                                message: '界面被弹窗遮挡，无法创建新对话',
                                type: 'service_unavailable',
                                code: 'dialog_blocked',
                            },
                        });
                        throw err;
                    }
                }
                throw err;
            }
            const newSessionUrl = initResult.url;
            dm.update_web_url(newSessionUrl);
            logSessionTrace('after_bind_new_session_url', dm, traceId);
            return newSessionUrl;
        };
        if (!dm.is_linked()) {
            logSessionTrace('before_link_check_unlinked', dm, traceId);
            // 未链接：初始化对话
            console.log(`[Controller] 模型 ${internalReq.model} 未链接，开始初始化对话...`);
            try {
                sessionUrl = await initializeConversationAndBind();
            }
            catch (err) {
                if (err instanceof types_1.WebDriverError) {
                    if (err.code === types_1.WebDriverErrorCode.NOT_LOGGED_IN ||
                        err.code === types_1.WebDriverErrorCode.DIALOG_BLOCKED) {
                        return;
                    }
                }
                throw err;
            }
            console.log(`[Controller] 对话初始化完成，URL: ${sessionUrl}`);
        }
        else {
            logSessionTrace('before_link_check_linked', dm, traceId);
            // 已链接：直接获取 session URL
            sessionUrl = dm.get_web_url();
            console.log(`[Controller] 使用已有对话，URL: ${sessionUrl}`);
            if (shouldSwitchContextByUsage(dm)) {
                console.log(`[Controller] 检测到上下文额度接近阈值，切换到新会话...`);
                try {
                    sessionUrl = await initializeConversationAndBind();
                }
                catch (err) {
                    if (err instanceof types_1.WebDriverError) {
                        if (err.code === types_1.WebDriverErrorCode.NOT_LOGGED_IN ||
                            err.code === types_1.WebDriverErrorCode.DIALOG_BLOCKED) {
                            return;
                        }
                    }
                    throw err;
                }
                console.log(`[Controller] 已切换新会话，URL: ${sessionUrl}`);
            }
        }
        // ===== Step 6: 发送当前消息 =====
        const currentPrompt = dm.get_current_prompt();
        logRequestTrace(traceId, 'chat_dispatch', {
            site,
            session_url: sessionUrl,
            current_prompt_length: currentPrompt.length,
        });
        let chatResult;
        try {
            chatResult = await webDriver.chat(site, sessionUrl, currentPrompt);
        }
        catch (err) {
            if (err instanceof types_1.WebDriverError) {
                if (err.code === types_1.WebDriverErrorCode.INVALID_SESSION_URL) {
                    // session 失效，取消链接状态，让下次重新初始化
                    dm.cancel_linked();
                    res.status(422).json({
                        error: {
                            message: 'Session 链接无效，请重新发送请求以初始化新对话',
                            type: 'invalid_request_error',
                            code: 'invalid_session_url',
                        },
                    });
                    return;
                }
                if (err.code === types_1.WebDriverErrorCode.RESPONSE_TIMEOUT) {
                    res.status(408).json({
                        error: {
                            message: '等待模型响应超时，请稍后重试',
                            type: 'timeout_error',
                            code: 'response_timeout',
                        },
                    });
                    return;
                }
                throw err;
            }
            throw err;
        }
        // ===== Step 7: 处理响应 —— 确保返回 JSON 格式 =====
        let responseContent = chatResult.content;
        let parsedJson = extractJson(responseContent);
        let upstreamError = detectUpstreamServiceError(responseContent);
        const maxRetries = 2;
        let retryCount = 0;
        while (!parsedJson && !upstreamError && retryCount < maxRetries) {
            console.log(`[Controller] 模型未返回 JSON 格式，重新发送（第 ${retryCount + 1} 次）... ` +
                `preview=${responseContent.slice(0, 160).replace(/\s+/g, ' ')}`);
            const templatePrompt = dm.get_current_prompt_with_template();
            try {
                const retryResult = await webDriver.chat(site, sessionUrl, templatePrompt);
                responseContent = retryResult.content;
                parsedJson = extractJson(responseContent);
                upstreamError = detectUpstreamServiceError(responseContent);
            }
            catch {
                break;
            }
            retryCount++;
        }
        if (upstreamError) {
            sendUpstreamServiceError(res, upstreamError);
            logRequestTrace(traceId, 'upstream_error_detected', upstreamError);
            return;
        }
        // ===== Step 8: 更新 DataManager 与响应载荷（共用同一个解析对象） =====
        let parsedChoiceObj = null;
        let messagePayload = {
            content: responseContent,
        };
        if (parsedJson) {
            try {
                const jsonResponse = JSON.parse(parsedJson);
                parsedChoiceObj = jsonResponse?.choices?.[0] ?? jsonResponse;
                if (parsedChoiceObj?.message && typeof parsedChoiceObj.message === 'object') {
                    dm.update_current(parsedChoiceObj.message);
                    messagePayload = {
                        content: parsedChoiceObj.message.content ?? responseContent,
                        tool_calls: parsedChoiceObj.message.tool_calls,
                        finish_reason: parsedChoiceObj.finish_reason,
                    };
                }
                else {
                    dm.update_current({
                        role: 'assistant',
                        content: responseContent,
                    });
                }
            }
            catch {
                // JSON 解析失败，回退到纯文本包装
                dm.update_current({
                    role: 'assistant',
                    content: responseContent,
                });
            }
        }
        else {
            dm.update_current({
                role: 'assistant',
                content: responseContent,
            });
        }
        await dm.save_data();
        logSessionTrace('after_save_assistant', dm, traceId);
        // ===== Step 9: 构造并返回响应 =====
        // 统一通过 protocol.format 返回 OpenAI 格式（与 DataManager 共用同源解析对象）
        const formattedResponse = protocol.format(internalReq.model, messagePayload, dm.get_usage().usage);
        logRequestTrace(traceId, 'response_ready', {
            model: internalReq.model,
            finish_reason: formattedResponse.choices?.[0]?.finish_reason,
            content_preview: formattedResponse.choices?.[0]?.message?.content?.slice?.(0, 80) ?? '',
            prompt_tokens: formattedResponse.usage?.prompt_tokens ?? 0,
            completion_tokens: formattedResponse.usage?.completion_tokens ?? 0,
            total_tokens: formattedResponse.usage?.total_tokens ?? 0,
        });
        (0, logger_1.logDebug)('chat_completions_response_payload', {
            trace_id: traceId,
            response_preview: JSON.stringify(formattedResponse).slice(0, 5000),
        });
        res.json(formattedResponse);
    }
    catch (err) {
        const fallbackTraceId = `req-error-${Date.now()}`;
        logRequestTrace(fallbackTraceId, 'handler_error', {
            message: err instanceof Error ? err.message : String(err),
        });
        next(err);
    }
}
/**
 * GET /v1/models — 返回支持的模型列表
 */
async function listModelsHandler(req, res) {
    const models = config.models ?? {};
    const modelList = Object.values(models)
        .flat()
        .map((id) => ({
        id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'webclaw-proxy',
    }));
    res.json({
        object: 'list',
        data: modelList,
    });
}
//# sourceMappingURL=openai.js.map