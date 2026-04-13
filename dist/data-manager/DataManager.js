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
exports.DataManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const types_1 = require("./types");
const hash_1 = require("./utils/hash");
const prompt_1 = require("./utils/prompt");
const logger_1 = require("../controller/logger");
// 加载配置
const configPath = path.join(process.cwd(), 'config', 'default.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
/**
 * 模型分类查找
 * 给定模型名称（如 "gpt-4o"），返回所属大类（小写，如 "gpt"）
 */
function findModelCategory(model, modelMap) {
    for (const [category, models] of Object.entries(modelMap)) {
        if (models.some((m) => m.toLowerCase() === model.toLowerCase())) {
            return category.toLowerCase();
        }
    }
    // 如果找不到，返回 model 名称本身（兜底）
    return model.toLowerCase().replace(/[^a-z0-9]/g, '_');
}
function getModelMapFromConfig() {
    const providers = (config.providers ?? {});
    const mapped = {};
    for (const [providerKey, provider] of Object.entries(providers)) {
        mapped[providerKey.toUpperCase()] = provider.models ?? [];
    }
    return mapped;
}
/**
 * DataManager — 数据管理核心类
 */
class DataManager {
    constructor(request, customConfig) {
        this.HASH_KEY = '';
        this.DATA_PATH = '';
        this.traceId = 'dm-na';
        this.model = request.model;
        this.system = request.system ?? '';
        this.history = [...(request.history ?? [])];
        this.tools = [...(request.tools ?? [])];
        this.current = request.current;
        this.config = {
            rootDir: customConfig?.rootDir ?? config.data?.root_dir ?? './data',
            models: customConfig?.models ?? getModelMapFromConfig(),
            responseSchemaTemplate: customConfig?.responseSchemaTemplate ??
                config.defaults?.response_schema_template ??
                '',
            initPromptTemplate: customConfig?.initPromptTemplate ??
                config.defaults?.init_prompt_template ??
                '此次对话的所有回答都必须严格按照下面的json模板进行回复，不能有任何例外:\n{{response_schema_template}}\n\n下面是此次对话的系统提示词，你只需要按约定的回复格式回复"收到"即可.\n{{system_prompt}}\n\n下面是你可以访问的工具：\n{{tools_prompt}}\n\n下面是之前的一些历史对话，仅供参考:\n{{history_prompt}}',
            userMessageTemplate: customConfig?.userMessageTemplate ??
                config.defaults?.user_message_template ??
                '',
            formatOnlyRetryTemplate: customConfig?.formatOnlyRetryTemplate ??
                config.defaults?.format_only_retry_template ??
                '你上一条回复不是合法 JSON。请仅按以下 JSON 模板重新输出，不要重复用户问题或额外解释：\n{{response_schema_template}}',
        };
        this.ROOT_DIR = path.resolve(this.config.rootDir);
        this.modelCategory = findModelCategory(this.model, this.config.models);
        this.update_hash_key();
        this.logDataTrace('constructor_initialized', {
            model: this.model,
            history_count: this.history.length,
            tools_count: this.tools.length,
            hash_key: this.HASH_KEY,
            data_path: this.DATA_PATH,
        });
    }
    set_trace_id(traceId) {
        this.traceId = traceId || this.traceId;
        this.logDataTrace('trace_attached', {
            trace_id: this.traceId,
            hash_key: this.HASH_KEY,
            data_path: this.DATA_PATH,
        });
    }
    /**
     * 计算 hash key 并更新 DATA_PATH。
     * 索引策略：每个 session 仅保留 latest_hash，不保留历史 hash 的可匹配入口。
     */
    update_hash_key(options) {
        const newHashKey = (0, hash_1.computeHashKey)(this.system, this.history, this.tools);
        const oldHashKey = this.HASH_KEY;
        this.logDataTrace('update_hash_key_start', {
            old_hash: oldHashKey || '-',
            new_hash: newHashKey,
            history_count: this.history.length,
            tools_count: this.tools.length,
            inherit_from: options?.inheritFromHash ?? '-',
        });
        this.HASH_KEY = newHashKey;
        const inheritFromHash = options?.inheritFromHash;
        this.bindLatestHash(newHashKey, inheritFromHash && inheritFromHash !== newHashKey ? inheritFromHash : undefined, Boolean(options?.forceNewSession));
        const sessionDir = this.getSessionDirByHash(newHashKey) ?? this.generateSessionDirName();
        this.DATA_PATH = this.resolveDataPath(sessionDir);
        const entry = this.getSessionEntryByHash(newHashKey);
        this.logDataTrace('update_hash_key_done', {
            old_hash: oldHashKey || '-',
            hash_key: this.HASH_KEY,
            session_dir: sessionDir,
            linked: Boolean(entry?.linked),
            web_url_count: entry?.web_urls.length ?? 0,
            data_path: this.DATA_PATH,
        });
    }
    /**
     * 判断当前 hash 是否已与 Web 建立链接（由 session-index 决定）
     */
    is_linked() {
        const entry = this.getSessionEntryByHash(this.HASH_KEY);
        if (!entry)
            return false;
        return entry.linked && entry.web_urls.length > 0;
    }
    /**
     * 保存对话数据到磁盘。
     * 修复点 A：首次保存也会把 current 同步进内存 history，再计算新 hash。
     */
    async save_data() {
        const oldHash = this.HASH_KEY;
        const hadUserHistoryBefore = this.history.some((msg) => msg.role === 'user');
        this.logDataTrace('save_data_start', {
            old_hash: oldHash || '-',
            history_count_before: this.history.length,
            current_role: this.current?.role,
            current_content_type: this.current ? (Array.isArray(this.current.content) ? 'array' : typeof this.current.content) : 'none',
        });
        // 先将 current 合并进 history（避免首轮写盘后内存 history 未更新造成 hash 链断裂）
        if (this.current && !this.isSameAsHistoryTail(this.current)) {
            this.history = [...this.history, this.current];
        }
        // history 变化后推进到新 hash。
        // 仅在“原始 history 已包含 user”场景继承 oldHash；
        // 若原始 history 为空（首轮），强制新建 session，避免同首句命中旧会话。
        this.update_hash_key({
            inheritFromHash: hadUserHistoryBefore ? oldHash : undefined,
            forceNewSession: !hadUserHistoryBefore,
        });
        // 在稳定 session_dir 下全量落盘
        this.ensureDataPath();
        fs.writeFileSync(path.join(this.DATA_PATH, 'system'), this.system, 'utf-8');
        this.writeHistoryJsonl(this.history);
        this.writeToolsJson();
        this.logDataTrace('save_data_done', {
            old_hash: oldHash || '-',
            new_hash: this.HASH_KEY,
            history_count_after: this.history.length,
            data_path: this.DATA_PATH,
        });
    }
    /**
     * 获取最新 Web session URL（同一 session 可映射多个 web_url，取最后一个）
     */
    get_web_url() {
        const entry = this.getSessionEntryByHash(this.HASH_KEY);
        if (!entry || entry.web_urls.length === 0) {
            this.logDataTrace('get_web_url_empty', {
                hash_key: this.HASH_KEY,
                linked: Boolean(entry?.linked),
            });
            return '';
        }
        const latest = entry.web_urls[entry.web_urls.length - 1] ?? '';
        this.logDataTrace('get_web_url_hit', {
            hash_key: this.HASH_KEY,
            linked: entry.linked,
            web_url_count: entry.web_urls.length,
            latest_web_url: latest,
        });
        return latest;
    }
    /**
     * 追加新的 Web URL 到当前 session 映射列表，并标记 linked
     */
    update_web_url(url) {
        const normalized = (url ?? '').trim();
        if (!normalized)
            return;
        this.logDataTrace('update_web_url_start', {
            hash_key: this.HASH_KEY,
            incoming_url: normalized,
        });
        this.updateSessionEntryByHash(this.HASH_KEY, (prev) => {
            const nextUrls = [...prev.web_urls, normalized];
            return {
                ...prev,
                web_urls: nextUrls,
                linked: true,
                updated_at: new Date().toISOString(),
            };
        });
        const entry = this.getSessionEntryByHash(this.HASH_KEY);
        this.logDataTrace('update_web_url_done', {
            hash_key: this.HASH_KEY,
            linked: Boolean(entry?.linked),
            web_url_count: entry?.web_urls.length ?? 0,
            latest_web_url: entry && entry.web_urls.length > 0 ? entry.web_urls[entry.web_urls.length - 1] : '',
        });
    }
    /**
     * 取消当前 hash 对应 session 的链接状态（保留历史 web_urls）
     */
    cancel_linked() {
        this.updateSessionEntryByHash(this.HASH_KEY, (prev) => ({
            ...prev,
            linked: false,
            updated_at: new Date().toISOString(),
        }));
    }
    update_current(current) {
        this.current = current;
    }
    /**
     * 会话链路可观测信息（用于 controller 调试日志）
     */
    get_session_debug_info() {
        const entry = this.getSessionEntryByHash(this.HASH_KEY);
        return {
            hash_key: this.HASH_KEY,
            data_path: this.DATA_PATH,
            session_dir: this.getSessionDirByHash(this.HASH_KEY) ?? path.basename(this.DATA_PATH || ''),
            linked: Boolean(entry?.linked),
            web_url_count: entry?.web_urls.length ?? 0,
            latest_web_url: entry && entry.web_urls.length > 0
                ? entry.web_urls[entry.web_urls.length - 1] ?? ''
                : '',
        };
    }
    get_system_prompt() {
        return (0, prompt_1.buildSystemPrompt)(this.system);
    }
    get_history_prompt() {
        return (0, prompt_1.buildHistoryPrompt)(this.history);
    }
    get_current_prompt() {
        return (0, prompt_1.buildCurrentPrompt)(this.current);
    }
    get_tools_prompt() {
        return (0, prompt_1.buildToolsPrompt)(this.tools);
    }
    get_response_schema_template() {
        return this.config.responseSchemaTemplate ?? '';
    }
    get_init_prompt() {
        return (0, prompt_1.buildInitPrompt)({
            template: this.config.initPromptTemplate,
            responseSchemaTemplate: this.config.responseSchemaTemplate,
            systemPrompt: this.get_system_prompt(),
            toolsPrompt: this.get_tools_prompt(),
            historyPrompt: this.get_history_prompt(),
        });
    }
    /**
     * 初始化新 web 会话时使用的提示词：
     * 若 history 尾部恰好是 current（常见于 save_data 已将 current 合并进 history），
     * 则剔除该尾部，避免“当前轮消息”污染 init_prompt 的历史区块。
     */
    get_init_prompt_for_new_session() {
        const historyForInit = this.isSameAsHistoryTail(this.current)
            ? this.history.slice(0, -1)
            : this.history;
        return (0, prompt_1.buildInitPrompt)({
            template: this.config.initPromptTemplate,
            responseSchemaTemplate: this.config.responseSchemaTemplate,
            systemPrompt: this.get_system_prompt(),
            toolsPrompt: this.get_tools_prompt(),
            historyPrompt: (0, prompt_1.buildHistoryPrompt)(historyForInit),
        });
    }
    get_usage() {
        const promptText = this.get_init_prompt();
        const completionText = JSON.stringify(this.current ?? {});
        const prompt_tokens = this.estimateTokenCount(promptText);
        const completion_tokens = this.estimateTokenCount(completionText);
        return {
            usage: {
                prompt_tokens,
                completion_tokens,
                total_tokens: prompt_tokens + completion_tokens,
            },
        };
    }
    get_format_only_retry_prompt() {
        const template = this.config.formatOnlyRetryTemplate ??
            '你上一条回复不是合法 JSON。请仅按以下 JSON 模板重新输出，不要重复用户问题或额外解释：\n{{response_schema_template}}';
        return template.replace('{{response_schema_template}}', this.config.responseSchemaTemplate ?? '');
    }
    /**
     * 发送到网页前的用户消息包装。
     * 注意：该包装仅用于首次发送，不影响 JSON 解析失败后的重试模板。
     */
    get_current_prompt_for_web_send() {
        return (0, prompt_1.buildCurrentPromptForWebSend)({
            template: this.config.userMessageTemplate,
            currentPrompt: this.get_current_prompt(),
        });
    }
    estimateTokenCount(text) {
        if (!text)
            return 0;
        let cjkCount = 0;
        let otherCount = 0;
        for (const ch of text) {
            if (/\s/.test(ch))
                continue;
            if (/[\u3400-\u9FFF\uF900-\uFAFF]/.test(ch)) {
                cjkCount++;
            }
            else {
                otherCount++;
            }
        }
        return cjkCount + Math.ceil(otherCount / 4);
    }
    ensureDataPath() {
        if (!this.DATA_PATH) {
            throw new types_1.DataManagerError(types_1.DataManagerErrorCode.DATA_PATH_NOT_INITIALIZED, 'DATA_PATH 未初始化，请先调用 save_data()');
        }
        if (!fs.existsSync(this.DATA_PATH)) {
            fs.mkdirSync(this.DATA_PATH, { recursive: true });
        }
    }
    writeHistoryJsonl(history) {
        const historyFile = path.join(this.DATA_PATH, 'history.jsonl');
        const content = history.map((m) => JSON.stringify(m)).join('\n');
        fs.writeFileSync(historyFile, content ? content + '\n' : '', 'utf-8');
    }
    writeToolsJson() {
        const toolsFile = path.join(this.DATA_PATH, 'tools.json');
        const sortedTools = [...this.tools].sort((a, b) => (a.function?.name ?? '').localeCompare(b.function?.name ?? ''));
        fs.writeFileSync(toolsFile, JSON.stringify(sortedTools, null, 2), 'utf-8');
    }
    isSameAsHistoryTail(message) {
        if (!this.history.length)
            return false;
        const tail = this.history[this.history.length - 1];
        return JSON.stringify(tail) === JSON.stringify(message);
    }
    getSessionIndexPath() {
        return path.join(this.ROOT_DIR, 'session-index', this.modelCategory, `${this.model}.json`);
    }
    resolveDataPath(sessionDir) {
        return path.join(this.ROOT_DIR, this.modelCategory, this.model, sessionDir);
    }
    generateSessionDirName() {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const ms = String(now.getMilliseconds()).padStart(3, '0');
        const rand = Math.random().toString(36).slice(2, 8);
        // 使用首次创建会话时的日期时间作为稳定目录名
        return `${y}${m}${d}-${hh}${mm}${ss}${ms}-${rand}`;
    }
    loadSessionIndex() {
        const indexPath = this.getSessionIndexPath();
        if (!fs.existsSync(indexPath)) {
            return { sessions: {}, latest_hash_to_session: {} };
        }
        try {
            const raw = fs.readFileSync(indexPath, 'utf-8').trim();
            if (!raw)
                return { sessions: {}, latest_hash_to_session: {} };
            const parsed = JSON.parse(raw);
            return this.normalizeSessionIndex(parsed);
        }
        catch {
            return { sessions: {}, latest_hash_to_session: {} };
        }
    }
    normalizeSessionIndex(parsed) {
        if (parsed.sessions &&
            parsed.latest_hash_to_session) {
            const normalized = {
                sessions: { ...parsed.sessions },
                latest_hash_to_session: { ...parsed.latest_hash_to_session },
            };
            return normalized;
        }
        // 兼容旧结构：{ hashes: Record<hash, { session_dir, ... }> }
        const legacy = parsed;
        const hashes = legacy.hashes ?? {};
        const sessions = {};
        const latest_hash_to_session = {};
        const items = Object.entries(hashes).sort((a, b) => {
            const ta = Date.parse(a[1].updated_at || a[1].created_at || '1970-01-01T00:00:00.000Z');
            const tb = Date.parse(b[1].updated_at || b[1].created_at || '1970-01-01T00:00:00.000Z');
            return ta - tb;
        });
        for (const [hash, entry] of items) {
            const sessionDir = entry.session_dir || this.generateSessionDirName();
            const prev = sessions[sessionDir];
            const mergedUrls = prev ? [...prev.web_urls] : [];
            for (const url of entry.web_urls ?? []) {
                if (!mergedUrls.includes(url))
                    mergedUrls.push(url);
            }
            if (prev?.latest_hash && prev.latest_hash !== hash) {
                delete latest_hash_to_session[prev.latest_hash];
            }
            sessions[sessionDir] = {
                latest_hash: hash,
                web_urls: mergedUrls,
                linked: Boolean(entry.linked) || Boolean(prev?.linked),
                created_at: prev?.created_at || entry.created_at || new Date().toISOString(),
                updated_at: entry.updated_at || new Date().toISOString(),
            };
            latest_hash_to_session[hash] = sessionDir;
        }
        return { sessions, latest_hash_to_session };
    }
    saveSessionIndex(index) {
        const indexPath = this.getSessionIndexPath();
        fs.mkdirSync(path.dirname(indexPath), { recursive: true });
        fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
        this.logDataTrace('save_session_index', {
            index_path: indexPath,
            session_count: Object.keys(index.sessions).length,
        });
    }
    defaultSessionEntry(latestHash, base) {
        const nowIso = new Date().toISOString();
        return {
            latest_hash: latestHash,
            web_urls: base?.web_urls ?? [],
            linked: base?.linked ?? false,
            created_at: base?.created_at ?? nowIso,
            updated_at: base?.updated_at ?? nowIso,
        };
    }
    getSessionDirByHash(hash) {
        const index = this.loadSessionIndex();
        return index.latest_hash_to_session[hash];
    }
    getSessionEntryByHash(hash) {
        const index = this.loadSessionIndex();
        const sessionDir = index.latest_hash_to_session[hash];
        if (!sessionDir)
            return undefined;
        return index.sessions[sessionDir];
    }
    bindLatestHash(newHash, inheritFromHash, forceNewSession = false) {
        const index = this.loadSessionIndex();
        const nowIso = new Date().toISOString();
        let targetSessionDir;
        if (inheritFromHash) {
            targetSessionDir = index.latest_hash_to_session[inheritFromHash];
            if (targetSessionDir) {
                delete index.latest_hash_to_session[inheritFromHash];
            }
        }
        if (!targetSessionDir && !forceNewSession) {
            targetSessionDir = index.latest_hash_to_session[newHash];
        }
        if (!targetSessionDir) {
            targetSessionDir = this.generateSessionDirName();
        }
        const prev = index.sessions[targetSessionDir] ?? this.defaultSessionEntry(newHash);
        if (prev.latest_hash && prev.latest_hash !== newHash) {
            delete index.latest_hash_to_session[prev.latest_hash];
        }
        index.sessions[targetSessionDir] = {
            ...prev,
            latest_hash: newHash,
            updated_at: nowIso,
            created_at: prev.created_at || nowIso,
        };
        index.latest_hash_to_session[newHash] = targetSessionDir;
        this.saveSessionIndex(index);
        this.logDataTrace('bind_latest_hash_done', {
            new_hash: newHash,
            inherited_from: inheritFromHash ?? '-',
            force_new_session: forceNewSession,
            session_dir: targetSessionDir,
            linked: index.sessions[targetSessionDir].linked,
            web_url_count: index.sessions[targetSessionDir].web_urls.length,
        });
    }
    updateSessionEntryByHash(hash, updater) {
        const index = this.loadSessionIndex();
        const nowIso = new Date().toISOString();
        let sessionDir = index.latest_hash_to_session[hash];
        if (!sessionDir) {
            sessionDir = this.generateSessionDirName();
            index.latest_hash_to_session[hash] = sessionDir;
            index.sessions[sessionDir] = this.defaultSessionEntry(hash);
        }
        const prev = index.sessions[sessionDir] ?? this.defaultSessionEntry(hash);
        const next = updater(prev);
        index.sessions[sessionDir] = {
            ...next,
            latest_hash: hash,
            created_at: next.created_at || prev.created_at || nowIso,
            updated_at: next.updated_at || nowIso,
        };
        index.latest_hash_to_session[hash] = sessionDir;
        this.saveSessionIndex(index);
    }
    logDataTrace(stage, payload) {
        try {
            console.log(`[DataTrace][${this.traceId}] stage=${stage} payload=${(0, logger_1.stringifyLogPayload)(payload)}`);
        }
        catch {
            console.log(`[DataTrace][${this.traceId}] stage=${stage} payload=[unserializable]`);
        }
    }
}
exports.DataManager = DataManager;
//# sourceMappingURL=DataManager.js.map