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

export { WebDriverManager } from './WebDriverManager';
export {
  SiteKey,
  InitConversationResult,
  ChatResult,
  PromptDispatchMode,
  PromptDispatchOptions,
  WebDriverManagerOptions,
  IWebDriver,
  WebDriverError,
  WebDriverErrorCode,
} from './types';

// 也导出各个驱动类，方便高级用户直接使用
export { BaseDriver } from './drivers/BaseDriver';
export { ChatGPTDriver } from './drivers/ChatGPTDriver';
export { QwenDriver } from './drivers/QwenDriver';
export { DeepSeekDriver } from './drivers/DeepSeekDriver';
export { KimiDriver } from './drivers/KimiDriver';
export { GLMDriver } from './drivers/GLMDriver';
