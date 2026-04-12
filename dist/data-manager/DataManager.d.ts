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
     * 使用“索引映射模式”：目录由首次会话创建日期生成，hash 演进复用同一 session_dir。
     */
    update_hash_key(options?: {
        inheritFromHash?: string;
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
     * 获取最新 Web session URL（同一 hash 可映射多个 web_url，取最后一个）
     */
    get_web_url(): string;
    /**
     * 追加新的 Web URL 到当前 hash 映射列表，并标记 linked
     */
    update_web_url(url: string): void;
    /**
     * 取消当前 hash 的链接状态（保留历史 web_urls）
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
    get_usage(): {
        usage: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
        };
    };
    get_current_prompt_with_template(): string;
    private estimateTokenCount;
    private ensureDataPath;
    private writeHistoryJsonl;
    private writeToolsJson;
    private isSameAsHistoryTail;
    private getSessionIndexPath;
    private resolveDataPath;
    private generateSessionDirName;
    private loadSessionIndex;
    private saveSessionIndex;
    private defaultSessionIndexEntry;
    private ensureHashIndexEntry;
    private getSessionIndexEntry;
    private updateSessionIndexEntry;
    private inheritSessionIndex;
    private logDataTrace;
}
//# sourceMappingURL=DataManager.d.ts.map