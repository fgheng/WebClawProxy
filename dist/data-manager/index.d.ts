/**
 * 数据管理模块入口
 *
 * 对外暴露：
 * - DataManager：核心管理类
 * - 类型定义：DataManagerConfig, DataManagerError 等
 *
 * 使用示例：
 * ```typescript
 * import { DataManager } from './src/data-manager';
 * import { OpenAIProtocol } from './src/protocol';
 *
 * const protocol = new OpenAIProtocol();
 * const internalReq = protocol.parse(openAIRequest);
 *
 * const dm = new DataManager(internalReq);
 * await dm.save_data();
 *
 * // 获取各种 prompt
 * console.log(dm.get_init_prompt());
 * console.log(dm.get_current_prompt());
 * console.log(dm.get_system_prompt());
 *
 * // 获取/更新 web 链接
 * dm.update_web_url('https://chat.deepseek.com/a/chat/s/xxxx');
 * console.log(dm.get_web_url());
 *
 * // 判断是否已链接
 * console.log(dm.is_linked());
 * ```
 */
export { DataManager } from './DataManager';
export { DataManagerConfig, DataManagerError, DataManagerErrorCode, ModelCategory, } from './types';
export { computeHashKey, computeSystemHash, computeHistoryHash, computeToolsHash } from './utils/hash';
export { buildSystemPrompt, buildHistoryPrompt, buildCurrentPrompt, buildToolsPrompt, buildInitPrompt, buildCurrentPromptWithTemplate, contentToString, } from './utils/prompt';
//# sourceMappingURL=index.d.ts.map