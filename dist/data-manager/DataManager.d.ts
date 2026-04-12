import { InternalRequest, Message, Tool } from '../protocol/types';
import { DataManagerConfig } from './types';
/**
 * DataManager — 数据管理核心类
 */
export declare class DataManager {
    model: string;
    system: string;
    history: Message[];
    tools: Tool[];
    current: Message;
    HASH_KEY: string;
    DATA_PATH: string;
    ROOT_DIR: string;
    private config;
    private modelCategory;
    private traceId;
    constructor(request: InternalRequest, customConfig?: Partial<DataManagerConfig>);
    set_trace_id(traceId: string): void;
    /**
     * 计算 hash key 并更新 DATA_PATH。
     * 索引策略：每个 session 仅保留 latest_hash，不保留历史 hash 的可匹配入口。
     */
    update_hash_key(options?: {
        inheritFromHash?: string;
        forceNewSession?: boolean;
    }): void;
    /**
     * 判断当前 hash 是否已与 Web 建立链接（由 session-index 决定）
     */
    is_linked(): boolean;
    /**
     * 保存对话数据到磁盘。
     * 修复点 A：首次保存也会把 current 同步进内存 history，再计算新 hash。
     */
    save_data(): Promise<void>;
    /**
     * 获取最新 Web session URL（同一 session 可映射多个 web_url，取最后一个）
     */
    get_web_url(): string;
    /**
     * 追加新的 Web URL 到当前 session 映射列表，并标记 linked
     */
    update_web_url(url: string): void;
    /**
     * 取消当前 hash 对应 session 的链接状态（保留历史 web_urls）
     */
    cancel_linked(): void;
    update_current(current: Message): void;
    /**
     * 会话链路可观测信息（用于 controller 调试日志）
     */
    get_session_debug_info(): {
        hash_key: string;
        data_path: string;
        session_dir: string;
        linked: boolean;
        web_url_count: number;
        latest_web_url: string;
    };
    get_system_prompt(): string;
    get_history_prompt(): string;
    get_current_prompt(): string;
    get_tools_prompt(): string;
    get_init_prompt(): string;
    /**
     * 初始化新 web 会话时使用的提示词：
     * 若 history 尾部恰好是 current（常见于 save_data 已将 current 合并进 history），
     * 则剔除该尾部，避免“当前轮消息”污染 init_prompt 的历史区块。
     */
    get_init_prompt_for_new_session(): string;
    get_usage(): {
        usage: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
        };
    };
    get_current_prompt_with_template(): string;
    get_format_only_retry_prompt(): string;
    /**
     * 发送到网页前的用户消息包装。
     * 注意：该包装仅用于首次发送，不影响 JSON 解析失败后的重试模板。
     */
    get_current_prompt_for_web_send(): string;
    private estimateTokenCount;
    private ensureDataPath;
    private writeHistoryJsonl;
    private writeToolsJson;
    private isSameAsHistoryTail;
    private getSessionIndexPath;
    private resolveDataPath;
    private generateSessionDirName;
    private loadSessionIndex;
    private normalizeSessionIndex;
    private saveSessionIndex;
    private pruneSessionIndex;
    private defaultSessionEntry;
    private getSessionDirByHash;
    private getSessionEntryByHash;
    private bindLatestHash;
    private updateSessionEntryByHash;
    private logDataTrace;
}
//# sourceMappingURL=DataManager.d.ts.map