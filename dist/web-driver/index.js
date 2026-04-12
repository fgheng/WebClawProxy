"use strict";
/**
 * Web 驱动模块入口
 *
 * 对外暴露：
 * - WebDriverManager：核心管理类，提供三个主要服务
 * - 类型定义：SiteKey, InitConversationResult, ChatResult 等
 * - 错误类：WebDriverError, WebDriverErrorCode
 *
 * 使用示例：
 * ```typescript
 * import { WebDriverManager, SiteKey } from './web-driver';
 *
 * const manager = new WebDriverManager();
 *
 * // 对话初始化
 * const { url } = await manager.initConversation('gpt', '你好，这是测试');
 * console.log('对话 URL:', url);
 *
 * // 发起对话
 * const { content } = await manager.chat('gpt', url, '请介绍一下自己');
 * console.log('模型回复:', content);
 *
 * // 关闭浏览器
 * await manager.close();
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.KimiDriver = exports.DeepSeekDriver = exports.QwenDriver = exports.ChatGPTDriver = exports.BaseDriver = exports.WebDriverErrorCode = exports.WebDriverError = exports.WebDriverManager = void 0;
var WebDriverManager_1 = require("./WebDriverManager");
Object.defineProperty(exports, "WebDriverManager", { enumerable: true, get: function () { return WebDriverManager_1.WebDriverManager; } });
var types_1 = require("./types");
Object.defineProperty(exports, "WebDriverError", { enumerable: true, get: function () { return types_1.WebDriverError; } });
Object.defineProperty(exports, "WebDriverErrorCode", { enumerable: true, get: function () { return types_1.WebDriverErrorCode; } });
// 也导出各个驱动类，方便高级用户直接使用
var BaseDriver_1 = require("./drivers/BaseDriver");
Object.defineProperty(exports, "BaseDriver", { enumerable: true, get: function () { return BaseDriver_1.BaseDriver; } });
var ChatGPTDriver_1 = require("./drivers/ChatGPTDriver");
Object.defineProperty(exports, "ChatGPTDriver", { enumerable: true, get: function () { return ChatGPTDriver_1.ChatGPTDriver; } });
var QwenDriver_1 = require("./drivers/QwenDriver");
Object.defineProperty(exports, "QwenDriver", { enumerable: true, get: function () { return QwenDriver_1.QwenDriver; } });
var DeepSeekDriver_1 = require("./drivers/DeepSeekDriver");
Object.defineProperty(exports, "DeepSeekDriver", { enumerable: true, get: function () { return DeepSeekDriver_1.DeepSeekDriver; } });
var KimiDriver_1 = require("./drivers/KimiDriver");
Object.defineProperty(exports, "KimiDriver", { enumerable: true, get: function () { return KimiDriver_1.KimiDriver; } });
//# sourceMappingURL=index.js.map