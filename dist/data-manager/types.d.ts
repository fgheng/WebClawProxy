/**
 * 数据管理模块重导出内部统一结构类型，方便外部直接引用
 */
export { Message, Tool, ContentItem, InternalRequest } from '../protocol/types';
/**
 * 数据管理模块配置
 */
export interface DataManagerConfig {
    rootDir: string;
    models: Record<string, string[]>;
    jsonTemplate?: string;
    initPromptTemplate?: string;
    currentTemplate?: string;
}
/**
 * 模型分类信息
 */
export interface ModelCategory {
    /** 模型大类名（小写），如 "gpt" */
    category: string;
    /** 模型名称，如 "gpt-4o" */
    model: string;
}
/**
 * 数据管理模块错误
 */
export declare enum DataManagerErrorCode {
    HASH_COMPUTE_ERROR = "HASH_COMPUTE_ERROR",
    DIRECTORY_CREATE_ERROR = "DIRECTORY_CREATE_ERROR",
    FILE_READ_ERROR = "FILE_READ_ERROR",
    FILE_WRITE_ERROR = "FILE_WRITE_ERROR",
    MODEL_NOT_FOUND = "MODEL_NOT_FOUND",
    DATA_PATH_NOT_INITIALIZED = "DATA_PATH_NOT_INITIALIZED"
}
export declare class DataManagerError extends Error {
    readonly code: DataManagerErrorCode;
    readonly cause?: Error | undefined;
    constructor(code: DataManagerErrorCode, message: string, cause?: Error | undefined);
}
//# sourceMappingURL=types.d.ts.map