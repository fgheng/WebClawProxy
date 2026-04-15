# Web 驱动模块文档

## 概述

Web 驱动模块（`src/web-driver/`）是 WebClawProxy 的核心基础模块，负责与各大 AI 模型 Web 页面进行自动化交互。

该模块基于 [Playwright](https://playwright.dev/) 构建，提供统一的服务接口，屏蔽各网站的 UI 差异。

当前真实实现还包含：

- 启动阶段统一登录预检（`preflightConfiguredSites`）
- 可选的站点预打开（`openConfiguredSites`）
- 长 prompt 自动分块发送
- `sendOnly()` 只发送不提取回复内容

## 支持的网站

| SiteKey  | 网站 URL                       |
|----------|-------------------------------|
| `gpt`    | https://chatgpt.com/          |
| `qwen`   | https://chat.qwen.ai/         |
| `deepseek` | https://chat.deepseek.com/  |
| `kimi`   | https://www.kimi.com/         |
| `glm`    | https://chatglm.cn/           |

## 快速开始

```typescript
import { WebDriverManager } from './src/web-driver';

// 创建实例
const manager = new WebDriverManager({
  headless: false,         // 是否无头模式（false = 显示浏览器窗口）
  responseTimeoutMs: 120000, // 等待模型响应超时（ms）
});

// 1. 对话初始化
const { url } = await manager.initConversation('gpt', '你好，这是一个测试对话');
console.log('对话 URL:', url);

// 2. 发起对话
const { content } = await manager.chat('gpt', url, '请介绍一下你自己');
console.log('模型回复:', content);

// 3. 关闭浏览器
await manager.close();
```

## API 文档

### WebDriverManager

核心管理类，对外提供多个服务，其中最常用的是：

- `initConversation()`
- `chat()`
- `sendOnly()`
- `openBrowser()`
- `preflightConfiguredSites()`
- `openConfiguredSites()`

#### 构造函数

```typescript
new WebDriverManager(options?: WebDriverManagerOptions)
```

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `headless` | `boolean` | `false` | 是否无头模式 |
| `responseTimeoutMs` | `number` | `120000` | 等待模型响应超时（ms） |
| `stabilityCheckIntervalMs` | `number` | `500` | 内容稳定检测间隔（ms） |
| `stabilityCheckCount` | `number` | `3` | 连续稳定次数才认为完成 |

---

#### `initConversation(site, initPrompt?)` — 对话初始化服务

新建一个对话并发送初始化提示词，返回对话 URL。

```typescript
async initConversation(
  site: SiteKey,
  initPrompt?: string
): Promise<InitConversationResult>
```

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `site` | `SiteKey` | 是 | 目标网站 key |
| `initPrompt` | `string` | 否 | 初始化提示词，默认从配置文件读取 |

**返回值：**

```typescript
interface InitConversationResult {
  url: string; // 新建对话的 URL
}
```

**错误码：**

| 错误码 | 说明 |
|--------|------|
| `NOT_LOGGED_IN` | 用户未登录（自动弹出浏览器等待登录） |
| `NEW_CONVERSATION_FAILED` | 新建对话失败（可能被广告/弹窗遮挡） |
| `DIALOG_BLOCKED` | 界面被弹窗遮挡 |

**实际行为说明：**

- 会先新建网页对话
- 发送初始化提示词
- 等待 URL 从首页变成对话 URL
- 再等待模型对初始化提示词“完成回复”
- 初始化回复内容本身不会被提取返回，只返回 `url`

**示例：**

```typescript
const { url } = await manager.initConversation('deepseek', '你是一个专业的助手');
// url = 'https://chat.deepseek.com/a/chat/s/xxxx'
```

---

#### `chat(site, sessionUrl, message)` — 对话服务

向指定的对话发送消息，并等待返回结果。

```typescript
async chat(
  site: SiteKey,
  sessionUrl: string,
  message: string
): Promise<ChatResult>
```

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `site` | `SiteKey` | 是 | 目标网站 key |
| `sessionUrl` | `string` | 是 | 对话 session URL（由 initConversation 返回） |
| `message` | `string` | 是 | 要发送的消息内容 |

**返回值：**

```typescript
interface ChatResult {
  content: string; // 模型的回复内容（已过滤思维链）
}
```

**实际行为说明：**

- 若当前页面不是目标 `sessionUrl`，会先跳转到该对话
- 发送前会等待页面稳定，避免消息被吞
- 发送后等待模型完成回复
- 最后再调用驱动的 `extractResponse()` 提取文本

**错误码：**

| 错误码 | 说明 |
|--------|------|
| `NOT_LOGGED_IN` | 用户未登录 |
| `INVALID_SESSION_URL` | session URL 无效，需重新初始化 |
| `RESPONSE_TIMEOUT` | 等待响应超时 |
| `RESPONSE_EXTRACTION_FAILED` | 提取响应内容失败 |
| `SEND_MESSAGE_FAILED` | 发送消息失败 |

**示例：**

```typescript
const { content } = await manager.chat(
  'gpt',
  'https://chatgpt.com/c/abc123',
  '请用 TypeScript 实现一个 hello world'
);
console.log(content);
```

---

#### `openBrowser(url, hint?)` — 浏览器弹出服务

打开浏览器并跳转到指定 URL，可附带提示信息。

```typescript
async openBrowser(url: string, hint?: string): Promise<void>
```

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `url` | `string` | 是 | 要打开的链接 |
| `hint` | `string` | 否 | 显示在浏览器上方的提示信息 |

**示例：**

```typescript
await manager.openBrowser(
  'https://chatgpt.com/',
  '请在此页面登录 ChatGPT，登录成功后系统将自动继续。'
);
```

---

#### `sendOnly(site, sessionUrl, message)` — 仅发送不提取回复

用于：

- 长消息分段发送时的前置分块
- 初始化/重试等“只要求网页端收到，不需要提取内容”的场景

```typescript
async sendOnly(
  site: SiteKey,
  sessionUrl: string,
  message: string
): Promise<void>
```

行为：

- 会复用与 `chat()` 相同的发送流程
- 会等待模型回复完成
- 但不会调用 `extractResponse()`

---

#### `preflightConfiguredSites(sites?)` — 登录预检

在服务启动阶段使用，逐站点确认登录态。

```typescript
async preflightConfiguredSites(sites?: SiteKey[]): Promise<void>
```

行为：

- 若未登录，会抛出 `NOT_LOGGED_IN`
- GUI/调用方可据此提示用户完成网页登录

---

#### `openConfiguredSites(sites?)` — 预打开站点

用于在服务启动后把配置中的站点页面提前打开，减少首次交互延迟。

```typescript
async openConfiguredSites(sites?: SiteKey[]): Promise<void>
```

- 若未传 `sites`
  - 默认打开全部已配置站点
- 若传入 `sites`
  - 仅打开指定站点

```typescript
await manager.openConfiguredSites(['gpt', 'deepseek']);
```

---

#### `close()` — 关闭浏览器

释放所有资源，关闭浏览器。

```typescript
async close(): Promise<void>
```

---

### 错误处理

所有错误均抛出 `WebDriverError` 实例：

```typescript
import { WebDriverError, WebDriverErrorCode } from './src/web-driver';

try {
  await manager.chat('gpt', invalidUrl, '你好');
} catch (err) {
  if (err instanceof WebDriverError) {
    switch (err.code) {
      case WebDriverErrorCode.INVALID_SESSION_URL:
        // 重新初始化对话
        break;
      case WebDriverErrorCode.RESPONSE_TIMEOUT:
        // 超时处理
        break;
      default:
        console.error(err.message);
    }
  }
}
```

**WebDriverErrorCode 枚举：**

| 错误码 | 说明 |
|--------|------|
| `NOT_LOGGED_IN` | 用户未登录 |
| `DIALOG_BLOCKED` | 界面被弹窗遮挡 |
| `INVALID_SESSION_URL` | session URL 无效 |
| `RESPONSE_TIMEOUT` | 等待响应超时 |
| `RESPONSE_EXTRACTION_FAILED` | 提取响应失败 |
| `NEW_CONVERSATION_FAILED` | 新建对话失败 |
| `SEND_MESSAGE_FAILED` | 发送消息失败 |
| `BROWSER_NOT_INITIALIZED` | 浏览器未初始化 |
| `UNKNOWN_SITE` | 未知的 site key |

---

## 架构说明

```
web-driver/
├── index.ts              # 模块入口，导出公共接口
├── types.ts              # 类型定义与错误类
├── WebDriverManager.ts   # 核心管理类
└── drivers/
    ├── BaseDriver.ts     # 抽象基类（多重检测策略）
    ├── ChatGPTDriver.ts  # ChatGPT 驱动
    ├── QwenDriver.ts     # Qwen 驱动
    ├── DeepSeekDriver.ts # DeepSeek 驱动
    └── KimiDriver.ts     # Kimi 驱动
```

### 多重回复检测策略

为了尽快检测到模型输出完成，使用 `Promise.race` 竞争以下两种策略：

1. **发送按钮恢复检测**：等待"停止"按钮消失（恢复为发送按钮），需先等待停止按钮出现以避免误判
2. **内容稳定性检测**：每 500ms 检测输出区域内容，连续 3 次相同则认为完成

注意：内容稳定性检测会先等待停止按钮出现再开始计时，避免模型尚未开始输出就误判完成。

### 长 prompt 分块发送

当 prompt 超过站点输入上限时，`WebDriverManager` 会自动拆分为多段发送。

当前真实分块结构：

- 第一块：

```text
<message>
<chunk id="1">
...
</chunk>
reply recieved in the required JSON format.
```

- 中间块：

```text
<chunk id="2">
...
</chunk>
reply recieved in the required JSON format.
```

- 最后一块：

```text
<chunk id="n">
...
</chunk>
</message>
The information has been sent. Please respond in the required JSON format.
```

说明：

- 第一块会打开 `<message>`
- 最后一块会闭合 `</message>`
- 非最后块只要求网页模型确认接收
- 最后一块才要求基于完整内容输出正式结果

### 添加新网站支持

1. 创建新的驱动类继承 `BaseDriver`
2. 实现以下抽象方法：
   - `isLoggedIn()`
   - `createNewConversation()`
   - `sendMessage(text)`
   - `extractResponse()`
   - `isValidConversationUrl(url)`
3. 覆盖以下可选方法（用于检测策略）：
   - `getStopButtonSelector()`
   - `getResponseAreaSelector()`
4. 在 `WebDriverManager.ts` 的 `getOrCreateDriver()` 中添加新 case
5. 在 `config/default.json` 的 `sites` 中添加新映射
6. 更新 `SiteKey` 类型

## 运行测试

```bash
# 单元测试（不需要浏览器）
npm run test:web-driver

# 功能测试脚本（需要浏览器，需先登录）
npm run script:web-driver
```
