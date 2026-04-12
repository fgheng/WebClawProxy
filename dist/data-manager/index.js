"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.contentToString = exports.buildCurrentPromptWithTemplate = exports.buildInitPrompt = exports.buildToolsPrompt = exports.buildCurrentPrompt = exports.buildHistoryPrompt = exports.buildSystemPrompt = exports.computeToolsHash = exports.computeHistoryHash = exports.computeSystemHash = exports.computeHashKey = exports.DataManagerErrorCode = exports.DataManagerError = exports.DataManager = void 0;
var DataManager_1 = require("./DataManager");
Object.defineProperty(exports, "DataManager", { enumerable: true, get: function () { return DataManager_1.DataManager; } });
var types_1 = require("./types");
Object.defineProperty(exports, "DataManagerError", { enumerable: true, get: function () { return types_1.DataManagerError; } });
Object.defineProperty(exports, "DataManagerErrorCode", { enumerable: true, get: function () { return types_1.DataManagerErrorCode; } });
// 工具函数
var hash_1 = require("./utils/hash");
Object.defineProperty(exports, "computeHashKey", { enumerable: true, get: function () { return hash_1.computeHashKey; } });
Object.defineProperty(exports, "computeSystemHash", { enumerable: true, get: function () { return hash_1.computeSystemHash; } });
Object.defineProperty(exports, "computeHistoryHash", { enumerable: true, get: function () { return hash_1.computeHistoryHash; } });
Object.defineProperty(exports, "computeToolsHash", { enumerable: true, get: function () { return hash_1.computeToolsHash; } });
var prompt_1 = require("./utils/prompt");
Object.defineProperty(exports, "buildSystemPrompt", { enumerable: true, get: function () { return prompt_1.buildSystemPrompt; } });
Object.defineProperty(exports, "buildHistoryPrompt", { enumerable: true, get: function () { return prompt_1.buildHistoryPrompt; } });
Object.defineProperty(exports, "buildCurrentPrompt", { enumerable: true, get: function () { return prompt_1.buildCurrentPrompt; } });
Object.defineProperty(exports, "buildToolsPrompt", { enumerable: true, get: function () { return prompt_1.buildToolsPrompt; } });
Object.defineProperty(exports, "buildInitPrompt", { enumerable: true, get: function () { return prompt_1.buildInitPrompt; } });
Object.defineProperty(exports, "buildCurrentPromptWithTemplate", { enumerable: true, get: function () { return prompt_1.buildCurrentPromptWithTemplate; } });
Object.defineProperty(exports, "contentToString", { enumerable: true, get: function () { return prompt_1.contentToString; } });
//# sourceMappingURL=index.js.map