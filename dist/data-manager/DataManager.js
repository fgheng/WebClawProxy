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
            models: customConfig?.models ?? config.models ?? {},
            jsonTemplate: customConfig?.jsonTemplate ?? config.defaults?.json_template ?? '',
            initPromptTemplate: customConfig?.initPromptTemplate ??
                config.defaults?.init_prompt_template ??
                '此次对话的所有回答都必须严格按照下面的json模板进行回复，不能有任何例外:\n{{json_template}}\n\n下面是此次对话的系统提示词，你只需要按约定的回复格式回复"收到"即可.\n{{system_prompt}}\n\n下面是你可以访问的工具：\n{{tools_prompt}}\n\n下面是之前的一些历史对话，仅供参考:\n{{history_prompt}}',
            currentTemplate: customConfig?.currentTemplate ??
                config.defaults?.current_template ??
                '请按照下面的模板回答\n{{json_template}}\n\n---\n{{current}}',
            userMessageTemplate: customConfig?.userMessageTemplate ??
                config.defaults?.user_message_template ??
                '',
            sessionIndexMaxEntries: customConfig?.sessionIndexMaxEntries ??
                config.session_index?.max_entries ??
                120,
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
     * 使用“索引映射模式”：目录由首次会话创建日期生成，hash 演进复用同一 session_dir。
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
        this.ensureHashIndexEntry(newHashKey);
        const inheritFromHash = options?.inheritFromHash;
        if (inheritFromHash && inheritFromHash !== newHashKey) {
            this.inheritSessionIndex(inheritFromHash, newHashKey);
        }
        else if (oldHashKey && oldHashKey !== newHashKey) {
            // 默认也做一次继承，确保 hash 演进链不断
            this.inheritSessionIndex(oldHashKey, newHashKey);
        }
        const entry = this.getSessionIndexEntry(newHashKey);
        const sessionDir = entry?.session_dir ?? this.generateSessionDirName();
        this.DATA_PATH = this.resolveDataPath(sessionDir);
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
        const entry = this.getSessionIndexEntry(this.HASH_KEY);
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
        // history 变化后，推进 hash 到新键，并继承会话索引（包含 session_dir）
        this.update_hash_key({ inheritFromHash: oldHash });
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
     * 获取最新 Web session URL（同一 hash 可映射多个 web_url，取最后一个）
     */
    get_web_url() {
        const entry = this.getSessionIndexEntry(this.HASH_KEY);
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
     * 追加新的 Web URL 到当前 hash 映射列表，并标记 linked
     */
    update_web_url(url) {
        const normalized = (url ?? '').trim();
        if (!normalized)
            return;
        this.logDataTrace('update_web_url_start', {
            hash_key: this.HASH_KEY,
            incoming_url: normalized,
        });
        this.updateSessionIndexEntry(this.HASH_KEY, (prev) => {
            const nextUrls = [...prev.web_urls, normalized];
            return {
                ...prev,
                web_urls: nextUrls,
                linked: true,
                updated_at: new Date().toISOString(),
            };
        });
        const entry = this.getSessionIndexEntry(this.HASH_KEY);
        this.logDataTrace('update_web_url_done', {
            hash_key: this.HASH_KEY,
            linked: Boolean(entry?.linked),
            web_url_count: entry?.web_urls.length ?? 0,
            latest_web_url: entry && entry.web_urls.length > 0 ? entry.web_urls[entry.web_urls.length - 1] : '',
        });
    }
    /**
     * 取消当前 hash 的链接状态（保留历史 web_urls）
     */
    cancel_linked() {
        this.updateSessionIndexEntry(this.HASH_KEY, (prev) => ({
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
        const entry = this.getSessionIndexEntry(this.HASH_KEY);
        return {
            hash_key: this.HASH_KEY,
            data_path: this.DATA_PATH,
            session_dir: entry?.session_dir ?? path.basename(this.DATA_PATH || ''),
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
    get_init_prompt() {
        return (0, prompt_1.buildInitPrompt)({
            template: this.config.initPromptTemplate,
            jsonTemplate: this.config.jsonTemplate,
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
            jsonTemplate: this.config.jsonTemplate,
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
    get_current_prompt_with_template() {
        return (0, prompt_1.buildCurrentPromptWithTemplate)({
            template: this.config.currentTemplate,
            jsonTemplate: this.config.jsonTemplate,
            currentPrompt: this.get_current_prompt(),
        });
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
            return { hashes: {} };
        }
        try {
            const raw = fs.readFileSync(indexPath, 'utf-8').trim();
            if (!raw)
                return { hashes: {} };
            const parsed = JSON.parse(raw);
            return {
                hashes: parsed?.hashes ?? {},
            };
        }
        catch {
            return { hashes: {} };
        }
    }
    saveSessionIndex(index) {
        const pruned = this.pruneSessionIndex(index);
        const indexPath = this.getSessionIndexPath();
        fs.mkdirSync(path.dirname(indexPath), { recursive: true });
        fs.writeFileSync(indexPath, JSON.stringify(pruned, null, 2), 'utf-8');
        this.logDataTrace('save_session_index', {
            index_path: indexPath,
            hash_count: Object.keys(pruned.hashes).length,
            max_entries: this.config.sessionIndexMaxEntries,
        });
    }
    pruneSessionIndex(index) {
        const max = this.config.sessionIndexMaxEntries;
        if (!max || max <= 0)
            return index;
        const entries = Object.entries(index.hashes);
        if (entries.length <= max)
            return index;
        entries.sort((a, b) => {
            const ta = Date.parse(a[1].updated_at || a[1].created_at || '1970-01-01T00:00:00.000Z');
            const tb = Date.parse(b[1].updated_at || b[1].created_at || '1970-01-01T00:00:00.000Z');
            return tb - ta;
        });
        const kept = entries.slice(0, max);
        const hashes = {};
        for (const [k, v] of kept) {
            hashes[k] = v;
        }
        return { hashes };
    }
    defaultSessionIndexEntry(sessionDir) {
        const nowIso = new Date().toISOString();
        return {
            session_dir: sessionDir ?? this.generateSessionDirName(),
            web_urls: [],
            linked: false,
            created_at: nowIso,
            updated_at: nowIso,
        };
    }
    ensureHashIndexEntry(hash) {
        const index = this.loadSessionIndex();
        if (!index.hashes[hash]) {
            index.hashes[hash] = this.defaultSessionIndexEntry();
            this.saveSessionIndex(index);
            this.logDataTrace('ensure_hash_index_entry_created', {
                hash_key: hash,
                session_dir: index.hashes[hash].session_dir,
            });
            return;
        }
        this.logDataTrace('ensure_hash_index_entry_exists', {
            hash_key: hash,
            session_dir: index.hashes[hash].session_dir,
            linked: index.hashes[hash].linked,
            web_url_count: index.hashes[hash].web_urls.length,
        });
    }
    getSessionIndexEntry(hash) {
        const index = this.loadSessionIndex();
        return index.hashes[hash];
    }
    updateSessionIndexEntry(hash, updater) {
        const index = this.loadSessionIndex();
        const prev = index.hashes[hash] ?? this.defaultSessionIndexEntry();
        const next = updater(prev);
        index.hashes[hash] = {
            ...next,
            session_dir: next.session_dir || prev.session_dir || this.generateSessionDirName(),
            created_at: next.created_at || prev.created_at || new Date().toISOString(),
            updated_at: next.updated_at || new Date().toISOString(),
        };
        this.saveSessionIndex(index);
    }
    inheritSessionIndex(fromHash, toHash) {
        if (!fromHash || !toHash || fromHash === toHash)
            return;
        const index = this.loadSessionIndex();
        const fromEntry = index.hashes[fromHash];
        if (!fromEntry) {
            if (!index.hashes[toHash]) {
                index.hashes[toHash] = this.defaultSessionIndexEntry();
            }
            this.saveSessionIndex(index);
            this.logDataTrace('inherit_session_index_miss_from_hash', {
                from_hash: fromHash,
                to_hash: toHash,
                to_session_dir: index.hashes[toHash].session_dir,
            });
            return;
        }
        const toEntry = index.hashes[toHash] ?? this.defaultSessionIndexEntry(fromEntry.session_dir);
        const mergedUrls = [...toEntry.web_urls];
        for (const url of fromEntry.web_urls) {
            if (!mergedUrls.includes(url)) {
                mergedUrls.push(url);
            }
        }
        index.hashes[toHash] = {
            session_dir: fromEntry.session_dir,
            web_urls: mergedUrls,
            linked: toEntry.linked || fromEntry.linked,
            created_at: fromEntry.created_at,
            updated_at: new Date().toISOString(),
        };
        this.saveSessionIndex(index);
        this.logDataTrace('inherit_session_index_done', {
            from_hash: fromHash,
            to_hash: toHash,
            session_dir: fromEntry.session_dir,
            from_linked: fromEntry.linked,
            to_linked: index.hashes[toHash].linked,
            merged_url_count: mergedUrls.length,
        });
    }
    logDataTrace(stage, payload) {
        try {
            console.log(`[DataTrace][${this.traceId}] stage=${stage} payload=${JSON.stringify(payload)}`);
        }
        catch {
            console.log(`[DataTrace][${this.traceId}] stage=${stage} payload=[unserializable]`);
        }
    }
}
exports.DataManager = DataManager;
//# sourceMappingURL=DataManager.js.map