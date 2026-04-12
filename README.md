# WebClawProxy

> 将各大 AI 模型 Web 页面封装成标准 API 接口（OpenAI 兼容）的代理服务

WebClawProxy 通过浏览器自动化技术，将 ChatGPT、DeepSeek、Qwen、Kimi 等 AI 模型的 Web 界面封装成 OpenAI 兼容的 API 接口，让任何支持 OpenAI SDK 的应用都能无缝接入这些模型。

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                       客户端请求                             │
│            (OpenAI SDK / Anthropic / Gemini / Llama)        │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   控制模块 (Controller)                       │
│              src/controller/ - Express HTTP 服务             │
└──────┬──────────────────┬──────────────────┬────────────────┘
       │                  │                  │
       ▼                  ▼                  ▼
┌──────────────┐ ┌──────────────────┐ ┌─────────────────────┐
│  协议转换模块  │ │   数据管理模块    │ │    Web 驱动模块      │
│ src/protocol/ │ │src/data-manager/ │ │  src/web-driver/    │
│               │ │                  │ │                     │
│ OpenAI ──────►│ │ 对话数据持久化    │ │ ChatGPT / DeepSeek  │
│ Anthropic (预)│ │ Hash Key 计算    │ │ Qwen / Kimi         │
│ Gemini (预)   │ │ Prompt 构造      │ │ (基于 Playwright)   │
└──────────────┘ └──────────────────┘ └─────────────────────┘
```

## 支持的网站

| 网站 | Key | URL |
|------|-----|-----|
| ChatGPT | `gpt` | https://chatgpt.com/ |
| Qwen | `qwen` | https://chat.qwen.ai/ |
| DeepSeek | `deepseek` | https://chat.deepseek.com/ |
| Kimi | `kimi` | https://www.kimi.com/ |

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 安装 Playwright 浏览器

```bash
npx playwright install chromium
```

### 3. 启动服务

```bash
# 开发模式
npm run dev

# 生产模式
npm run build && npm start
```

### 4. 发送请求

```bash
# 使用 curl 测试
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

服务启动后会自动打开浏览器，如未登录会提示用户完成登录。

## 集成使用

### Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="not-needed"
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "你是一个专业助手"},
        {"role": "user", "content": "你好"}
    ]
)
print(response.choices[0].message.content)
```

### Node.js

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
    baseURL: 'http://localhost:3000/v1',
    apiKey: 'not-needed',
});

const response = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: '你好' }],
});
console.log(response.choices[0].message.content);
```

## 运行测试

```bash
# 运行所有单元测试
npm test

# 运行特定模块测试
npm run test:protocol       # 协议转换模块
npm run test:data-manager   # 数据管理模块
npm run test:web-driver     # Web 驱动模块
npm run test:controller     # 控制模块

# 功能测试脚本（可直接运行）
npm run script:protocol     # 协议转换功能测试（mock 数据）
npm run script:data-manager # 数据管理功能测试（mock 数据）
npm run script:web-driver   # Web 驱动功能测试（真实浏览器）
npm run script:all          # 统一测试程序（mock 模式）
npm run script:all -- --mode=real --site=deepseek  # 真实浏览器集成测试
```

## 项目结构

```
WebClawProxy/
├── package.json
├── tsconfig.json
├── README.md
├── config/
│   └── default.json           # 配置文件（网站映射、模型映射、默认 prompt 等）
├── src/
│   ├── web-driver/            # Web 驱动模块
│   │   ├── index.ts           # 模块入口
│   │   ├── types.ts           # 类型定义
│   │   ├── WebDriverManager.ts # 核心服务类
│   │   └── drivers/
│   │       ├── BaseDriver.ts  # 抽象基类
│   │       ├── ChatGPTDriver.ts
│   │       ├── QwenDriver.ts
│   │       ├── DeepSeekDriver.ts
│   │       └── KimiDriver.ts
│   ├── protocol/              # 协议转换模块
│   │   ├── index.ts
│   │   ├── types.ts           # 内部统一结构类型
│   │   ├── BaseProtocol.ts    # 抽象基类
│   │   └── openai/
│   │       ├── OpenAIProtocol.ts
│   │       └── types.ts
│   ├── data-manager/          # 数据管理模块
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── DataManager.ts     # 核心类
│   │   └── utils/
│   │       ├── hash.ts        # Hash 计算
│   │       └── prompt.ts      # Prompt 构造
│   └── controller/            # 控制模块
│       ├── index.ts           # 服务入口
│       ├── server.ts          # Express 应用
│       └── routes/
│           └── openai.ts      # OpenAI 兼容路由
├── tests/
│   ├── web-driver/
│   ├── protocol/
│   ├── data-manager/
│   └── controller/
├── scripts/
│   ├── test-protocol.ts       # 协议模块功能测试
│   ├── test-data-manager.ts   # 数据管理功能测试
│   ├── test-web-driver.ts     # Web 驱动功能测试
│   └── test-all.ts            # 统一测试程序
└── docs/
    ├── web-driver.md
    ├── protocol.md
    ├── data-manager.md
    └── controller.md
```

## 配置文件

`config/default.json` 主要配置项：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `data.root_dir` | 数据存储根目录 | `./data` |
| `server.port` | HTTP 服务端口 | `3000` |
| `webdriver.headless` | 是否无头模式 | `false` |
| `webdriver.response_timeout_ms` | 等待响应超时 | `120000` |
| `sites.*` | 网站 key → URL 映射 | - |
| `models.*` | 模型大类 → 模型列表映射 | - |
| `defaults.init_prompt` | 默认初始化提示词 | - |

## 模块文档

- [Web 驱动模块](docs/web-driver.md) — 浏览器自动化、登录检测、消息发送/接收
- [协议转换模块](docs/protocol.md) — OpenAI 协议解析与格式转换
- [数据管理模块](docs/data-manager.md) — 对话数据持久化、Prompt 构造
- [控制模块](docs/controller.md) — HTTP 服务、请求处理流程

## 扩展

### 添加新网站支持

1. 继承 `BaseDriver` 创建新驱动类（参考 `src/web-driver/drivers/`）
2. 在 `WebDriverManager.ts` 中添加新 case
3. 在 `config/default.json` 的 `sites` 和 `models` 中添加映射
4. 更新 `SiteKey` 类型

### 添加新协议支持

1. 继承 `BaseProtocol` 创建新协议类（参考 `src/protocol/openai/`）
2. 在 `src/protocol/index.ts` 中导出
3. 在控制模块路由中添加对应的请求处理

## 注意事项

- 首次使用某个网站时，需要在弹出的浏览器中完成登录
- Web 界面选择器可能随网站更新而失效，需要及时更新对应驱动的 `SELECTORS` 配置
- 模型对话数据存储在 `data/` 目录下，按模型类别/模型名/hash 组织
- DeepSeek 等支持"思维链"的模型，`extractResponse()` 会自动过滤推理过程，只返回最终答案

## 技术栈

- **语言**: TypeScript
- **浏览器自动化**: Playwright
- **HTTP 服务**: Express.js
- **测试框架**: Jest
- **运行时**: Node.js 18+

## TODO

- [ ] GUI 支持，上方是浏览器，下方是请求客户端以及日志输出
- [ ] webclaw，开箱即用，打开 GUI，先登录上支持的网站，然后下面的终端里可以直接使用 claw 了，然后上方网页可以看到claw 后端到底是怎么运行的