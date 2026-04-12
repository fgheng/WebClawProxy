import { Message, Tool } from '../../protocol/types';
/**
 * 计算 system 提示词的 hash
 */
export declare function computeSystemHash(system: string): string;
/**
 * 计算 history 列表的 rolling hash
 * 逐条累积：hash = sha256(hash + canonicalize(message))
 */
export declare function computeHistoryHash(history: Message[]): string;
/**
 * 计算 tools 列表的 hash
 * 1. 先按 function.name 排序
 * 2. 序列化为 canonical JSON
 * 3. 计算 SHA256
 */
export declare function computeToolsHash(tools: Tool[]): string;
/**
 * 计算完整的 HASH_KEY
 * 格式：systemHash_historyHash_toolsHash
 */
export declare function computeHashKey(system: string, history: Message[], tools: Tool[]): string;
//# sourceMappingURL=hash.d.ts.map