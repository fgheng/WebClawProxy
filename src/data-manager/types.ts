import { Message, Tool, InternalRequest } from '../protocol/types';

/**
 * 数据管理模块重导出内部统一结构类型，方便外部直接引用
 */
export { Message, Tool, ContentItem, InternalRequest } from '../protocol/types';

/**
 * 数据管理模块配置
 */
export interface DataManagerConfig {
  rootDir: string;
  models: Record<string, string[]>; // 如 { GPT: ["gpt-4", "gpt-4o", ...] }
  jsonTemplate?: string;
  initPromptTemplate?: string;
  currentTemplate?: string;
  /** session-index 最多保留的 hash 条目数（按 updated_at 取最近） */
  sessionIndexMaxEntries?: number;
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
export enum DataManagerErrorCode {
  HASH_COMPUTE_ERROR = 'HASH_COMPUTE_ERROR',
  DIRECTORY_CREATE_ERROR = 'DIRECTORY_CREATE_ERROR',
  FILE_READ_ERROR = 'FILE_READ_ERROR',
  FILE_WRITE_ERROR = 'FILE_WRITE_ERROR',
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
  DATA_PATH_NOT_INITIALIZED = 'DATA_PATH_NOT_INITIALIZED',
}

export class DataManagerError extends Error {
  constructor(
    public readonly code: DataManagerErrorCode,
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'DataManagerError';
  }
}
