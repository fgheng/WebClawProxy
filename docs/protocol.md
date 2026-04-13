# 协议转换模块文档

## 概述

协议转换模块（`src/protocol/`）负责将各大模型厂商的 API 请求格式转换为 WebClawProxy 内部统一结构，并将内部响应结构转换回对应的厂商 API 格式。

当前支持：
- **OpenAI** 协议（完整实现）
- Anthropic 协议（保留扩展接口）
- Gemini 协议（保留扩展接口）
- Llama 协议（保留扩展接口）

## 内部统一结构

无论前端使用哪种协议，内部均使用以下统一结构：

```typescript
interface InternalRequest {
  model: string;      // 模型名称，如 "gpt-4o"
  system: string;     // 系统提示词（可为空）
  history: Message[]; // 对话历史（不含当前消息，不含 system 消息）
  tools: Tool[];      // 可用工具列表
  current: Message;   // 当前（最新）用户消息
}
```

### Message 结构

```typescript
interface Message {
  role: string; // "user" | "assistant" | "tool" 等
  content: string | ContentItem[];
}

interface ContentItem {
  type: 'text' | 'file' | 'image_url' | string;
  text?: string;
  file?: string;
  image_url?: string | { url: string; detail?: string };
}
```

### Tool 结构

```typescript
interface Tool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: {
      type: string;
      properties?: Record<string, { type?: string; description?: string }>;
      required?: string[];
    };
  };
}
```

## 快速开始

```typescript
import { OpenAIProtocol } from './src/protocol';

const protocol = new OpenAIProtocol();

// 解析 OpenAI 请求
const internalReq = protocol.parse({
  model: 'gpt-4o',
  messages: [
    { role: 'system', content: '你是一个助手' },
    { role: 'user', content: '你好' },
  ],
});

console.log(internalReq.model);   // "gpt-4o"
console.log(internalReq.system);  // "你是一个助手"
console.log(internalReq.history); // []（只有一条用户消息，成为 current）
console.log(internalReq.current); // { role: 'user', content: '你好' }

// 格式化响应
const openAIResp = protocol.format({
  content: '你好，有什么可以帮你？',
  model: 'gpt-4o',
  usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
});
```

## API 文档

### BaseProtocol（抽象基类）

```typescript
abstract class BaseProtocol {
  abstract parse(input: unknown): InternalRequest;
  abstract format(response: InternalResponse): unknown;
}
```

---

### OpenAIProtocol

#### `parse(input)` — 解析 OpenAI 请求

**提取规则：**

| 内部字段 | 来源 |
|----------|------|
| `model` | `input.model` |
| `system` | 提取 `messages` 中所有 `role === 'system'` 的文本内容并按原顺序拼接（以 `\n\n` 分隔） |
| `history` | 过滤掉所有 `role === 'system'` 的消息后，再去掉最后一条 |
| `tools` | `input.tools ?? []` |
| `current` | 过滤掉所有 system 后消息序列的最后一条 |

**示例输入（OpenAI 请求）：**

```json
{
  "model": "gpt-5.2",
  "messages": [
    { "role": "system", "content": "You are a personal assistant." },
    { "role": "user", "content": [{ "type": "text", "text": "你好" }] }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "read",
        "description": "Read a file",
        "parameters": {
          "type": "object",
          "required": ["path"],
          "properties": { "path": { "type": "string" } }
        }
      }
    }
  ]
}
```

**示例输出（内部结构）：**

```json
{
  "model": "gpt-5.2",
  "system": "You are a personal assistant.",
  "history": [],
  "tools": [{ "type": "function", "function": { "name": "read", ... } }],
  "current": { "role": "user", "content": [{ "type": "text", "text": "你好" }] }
}
```

> 说明：
> - `system` 会聚合所有 `role = system` 消息，拼接顺序与 `messages` 中出现顺序一致。
> - `history` 会移除所有 `system` 消息，并严格保持剩余消息的相对顺序（不重排）。

---

#### `format(response)` — 格式化为 OpenAI 响应

**输入（内部响应）：**

```typescript
interface InternalResponse {
  content?: string;
  tool_calls?: ToolCall[];
  finish_reason?: string;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}
```

**输出（OpenAI 响应格式）：**

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1775812436,
  "model": "gpt-4o",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "你好，有什么可以帮你？" },
    "logprobs": null,
    "finish_reason": "stop"
  }],
  "usage": { "prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30 }
}
```

---

## 错误处理

所有解析错误均抛出 `ProtocolParseError`：

```typescript
import { ProtocolParseError, ProtocolType } from './src/protocol';

try {
  const req = protocol.parse(invalidInput);
} catch (err) {
  if (err instanceof ProtocolParseError) {
    console.error(`协议: ${err.protocol}, 错误: ${err.message}`);
  }
}
```

---

## 扩展新协议

1. 继承 `BaseProtocol` 创建新的协议类：

```typescript
import { BaseProtocol } from './src/protocol';
import { InternalRequest, InternalResponse } from './src/protocol';

export class AnthropicProtocol extends BaseProtocol {
  parse(input: unknown): InternalRequest {
    // 实现 Anthropic → InternalRequest 的转换逻辑
  }

  format(response: InternalResponse): unknown {
    // 实现 InternalResponse → Anthropic 响应的转换逻辑
  }
}
```

2. 在 `src/protocol/index.ts` 中导出新协议类

---

## 架构说明

```
protocol/
├── index.ts              # 模块入口，统一导出
├── types.ts              # 内部统一结构类型定义
├── BaseProtocol.ts       # 抽象基类
└── openai/
    ├── OpenAIProtocol.ts # OpenAI 协议实现
    └── types.ts          # OpenAI 专用类型定义
```

## 运行测试

```bash
# 单元测试
npm run test:protocol

# 功能测试脚本
npm run script:protocol
```
