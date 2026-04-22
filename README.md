# WebClawProxy

将各大 AI 模型 Web 页面封装成标准 OpenAI API 接口的代理服务，支持 ChatGPT、Claude、DeepSeek、Qwen、Kimi、GLM、Doubao 等多个 AI Provider。

## 特性

- 🚀 **统一 API 接口**：将不同 AI 平台的 Web 界面统一封装为 OpenAI 兼容的 REST API
- 🔄 **双模式支持**：Web 模式（浏览器自动化）+ Forward 模式（API 直连），灵活切换
- 🎯 **Forward Monitor**：实时监控和调试转发的请求/响应，支持流式响应追踪和 Session 管理
- 🖥️ **桌面应用**：Electron 桌面客户端，提供可视化的服务管理、多 Provider 切换和监控界面
- 🌐 **多 Provider 支持**：ChatGPT (GPT-5.2/O3) / Claude (Opus 4/Sonnet 4) / DeepSeek / Qwen / Kimi / GLM / Doubao
- 🔧 **灵活配置**：支持自定义 Provider、Model、Cookie、超时时间等配置
- 📊 **Session Registry**：会话管理和追踪，支持查询、删除和统计
- 🔄 **Context Switch**：智能上下文切换，自动管理会话长度

## 系统要求

- **Node.js**: >= 18.0.0
- **pnpm**: >= 8.0.0
- **操作系统**: macOS / Linux / Windows
- **Chrome/Chromium**: 用于 Playwright 自动化

## 快速开始

### 1. 安装依赖

```bash
# 安装 pnpm（如果未安装）
npm install -g pnpm

# 安装所有依赖（包括 desktop 子项目）
pnpm install
```

### 2. 配置服务

编辑 `config/default.json`，配置你的 AI Providers：

```json
{
  "providers": {
    "deepseek": {
      "default_mode": "forward",
      "models": ["deepseek-chat", "deepseek-r1", "deepseek-v3"],
      "web": {
        "site": "https://chat.deepseek.com/",
        "input_max_chars": 120000
      },
      "forward": {
        "base_url": "https://api.deepseek.com",
        "api_key": "sk-your-api-key-here",
        "upstream_model_map": {
          "deepseek-chat": "deepseek-chat"
        }
      }
    },
    "gpt": {
      "default_mode": "web",
      "models": ["gpt-4", "gpt-4o", "gpt-5", "o1", "o3"],
      "web": {
        "site": "https://chatgpt.com/",
        "input_max_chars": 60000
      }
    },
    "claude": {
      "default_mode": "web",
      "models": ["claude-3-5-sonnet", "claude-sonnet-4", "claude-opus-4"],
      "web": {
        "site": "https://claude.ai/",
        "input_max_chars": 120000
      }
    }
  },
  "webdriver": {
    "response_timeout_ms": 120000,
    "headless": false,
    "startup_preflight_enabled": false,
    "startup_open_sites_enabled": true
  },
  "server": {
    "port": 3000
  }
}
```

> 💡 **配置说明**：
> - **default_mode**: `web`（浏览器自动化）或 `forward`（API 直连）
> - **web.site**: Web 界面 URL（web 模式需要）
> - **forward.api_key**: 上游 API 密钥（forward 模式需要）
> - **startup_preflight_enabled**: 服务启动时是否执行登录预检（false 可加速启动）
> - **startup_open_sites_enabled**: 服务启动时是否打开 Web 页面

> 💡 **如何获取 Cookie**（web 模式需要）：
> 1. 打开浏览器，登录对应的 AI 平台（如 ChatGPT）
> 2. 打开开发者工具（F12）→ Application → Cookies
> 3. 复制所有 Cookie 值（格式：`key1=value1; key2=value2`）
> 4. 在配置中添加 `"cookie": "your_cookie_here"`（注意：当前版本可能不需要手动配置 Cookie）

### 3. 启动服务

#### 方式一：CLI 命令行模式

```bash
# 开发模式（自动重启）
pnpm dev

# 生产模式
pnpm build
pnpm start
```

服务将在 `http://127.0.0.1:3000` 启动。

#### 方式二：桌面应用模式（推荐）

```bash
# 开发模式（热重载）
pnpm dev:desktop

# 生产模式
pnpm build:all
pnpm start:desktop
```

桌面应用提供：
- 可视化服务启动/停止控制
- 多 Provider Web 界面切换
- Forward Monitor 实时监控
- 内置终端和日志查看

### 4. 测试 API

```bash
# 发送测试请求
curl -X POST http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'
```

## 项目结构

```
WebClawProxy/
├── config/              # 配置文件目录
│   └── default.json     # 主配置文件
├── src/                 # 核心服务代码
│   ├── controller/      # API 路由和控制器
│   ├── web-driver/      # Playwright 自动化
│   ├── data-manager/    # 数据管理
│   └── protocol/        # 协议解析
├── desktop/             # Electron 桌面应用
│   ├── electron/        # Electron 主进程
│   └── src/             # React 渲染进程
├── tests/               # 测试用例
├── docs/                # 文档
└── pnpm-workspace.yaml  # pnpm workspace 配置
```

## 可用命令

### 根目录（服务端）

```bash
# 开发
pnpm dev                 # 启动服务（开发模式）
pnpm build               # 编译 TypeScript
pnpm start               # 启动服务（生产模式）

# 测试
pnpm test                # 运行所有测试
pnpm test:web-driver     # 测试 Web Driver
pnpm test:protocol       # 测试协议解析
pnpm test:controller     # 测试控制器

# 脚本
pnpm script:all          # 运行所有测试脚本
pnpm client              # 运行客户端测试
```

### Desktop（桌面应用）

```bash
# 开发
pnpm dev:desktop         # 启动桌面应用（开发模式）
pnpm build:desktop       # 编译桌面应用
pnpm start:desktop       # 启动桌面应用（生产模式）

# 一键构建所有
pnpm build:all           # 编译服务端 + 桌面端
```

## API 端点

### OpenAI 兼容接口

```
POST /v1/chat/completions
```

**请求体**：
```json
{
  "model": "gpt-4",
  "messages": [
    {"role": "user", "content": "Hello"}
  ],
  "stream": false
}
```

**响应**：
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "gpt-4",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hi! How can I help you today?"
    },
    "finish_reason": "stop"
  }]
}
```

### Forward Monitor 接口

Forward Monitor 提供实时的请求/响应监控和 Session 管理：

```
GET /v1/forward-monitor/events          # SSE 事件流（实时监控）
GET /v1/forward-monitor/sessions        # 获取所有 Session
GET /v1/forward-monitor/sessions/:id    # 获取单个 Session 详情
DELETE /v1/forward-monitor/sessions/:id # 删除指定 Session
GET /monitor                            # Forward Monitor Web 界面
```

**Session 示例**：

```bash
# 获取所有 Session
curl http://127.0.0.1:3000/v1/forward-monitor/sessions

# 响应示例
{
  "sessions": [
    {
      "sessionId": "sess_123abc",
      "provider": "gpt",
      "model": "gpt-4",
      "mode": "web",
      "createdAt": "2026-04-22T13:00:00.000Z",
      "requestCount": 5,
      "status": "active"
    }
  ]
}

# 获取单个 Session 详情
curl http://127.0.0.1:3000/v1/forward-monitor/sessions/sess_123abc

# 删除 Session
curl -X DELETE http://127.0.0.1:3000/v1/forward-monitor/sessions/sess_123abc
```

**实时监控（SSE）**：

```javascript
const eventSource = new EventSource('http://127.0.0.1:3000/v1/forward-monitor/events');

eventSource.addEventListener('session-start', (e) => {
  const data = JSON.parse(e.data);
  console.log('Session started:', data);
});

eventSource.addEventListener('message-chunk', (e) => {
  const data = JSON.parse(e.data);
  console.log('Message chunk:', data.content);
});

eventSource.addEventListener('session-end', (e) => {
  const data = JSON.parse(e.data);
  console.log('Session ended:', data);
});
```

## 配置说明

### Provider 配置

每个 Provider 支持以下配置项：

```json
{
  "providers": {
    "provider_key": {
      "default_mode": "web",              // 默认模式："web" 或 "forward"
      "models": ["model-1", "model-2"],   // 支持的模型列表
      "web": {
        "site": "https://example.com/",   // Web 界面 URL
        "input_max_chars": 120000         // 最大输入字符数
      },
      "forward": {
        "base_url": "https://api.example.com",  // API 端点
        "api_key": "sk-xxx",                     // API 密钥
        "upstream_model_map": {                  // 模型映射
          "local-model": "upstream-model"
        }
      }
    }
  }
}
```

### 支持的 Providers

| Provider | 模型示例 | Web 模式 | Forward 模式 |
|---------|---------|---------|-------------|
| **ChatGPT** | gpt-4, gpt-4o, gpt-5, gpt-5.1, gpt-5.2, o1, o3 | ✅ | ⚠️ 需配置 |
| **Claude** | claude-3-5-sonnet, claude-3-7-sonnet, claude-sonnet-4, claude-opus-4 | ✅ | ⚠️ 需配置 |
| **DeepSeek** | deepseek-chat, deepseek-r1, deepseek-v3 | ✅ | ✅ |
| **Qwen** | qwen-turbo, qwen-plus, qwen-max, qwen2.5-72b | ✅ | ⚠️ 需配置 |
| **Kimi** | moonshot-v1-8k, moonshot-v1-32k, kimi | ✅ | ⚠️ 需配置 |
| **GLM** | glm-4, glm-4-plus, glm-5, glm-5.1 | ✅ | ⚠️ 需配置 |
| **Doubao** | doubao, doubao-1.5-pro | ✅ | ⚠️ 需配置 |

### WebDriver 配置

```json
{
  "webdriver": {
    "response_timeout_ms": 120000,          // 响应超时时间（毫秒）
    "stability_check_interval_ms": 500,     // 稳定性检查间隔
    "stability_check_count": 3,             // 稳定性检查次数
    "headless": false,                      // 是否无头模式
    "startup_preflight_enabled": false,     // 启动时是否执行登录预检
    "startup_open_sites_enabled": true      // 启动时是否打开 Web 页面
  }
}
```

### 日志配置

```json
{
  "logging": {
    "enabled": true,                        // 是否启用日志
    "debug": true,                          // 是否启用调试日志
    "dir": ".data/logs",                    // 日志目录
    "file_prefix": "webclaw-proxy",         // 日志文件前缀
    "pretty_json": false,                   // 是否美化 JSON 输出
    "request_body_truncate_enabled": false, // 是否截断请求体
    "request_body_max_chars": 5000          // 请求体最大字符数
  }
}
```

### Context Switch 配置

自动管理会话上下文长度，防止超出模型限制：

```json
{
  "context_switch": {
    "enabled": true,              // 是否启用上下文切换
    "max_prompt_tokens": 120000,  // 最大 prompt tokens
    "max_total_tokens": 128000    // 最大总 tokens
  }
}
```

## 常见问题

### 1. Cookie 过期怎么办？

在 Web 模式下，如果遇到认证问题：
1. 重新登录对应平台
2. 更新 `config/default.json` 中的 Cookie 值（如果配置了）
3. 或者重启服务，让浏览器自动化重新登录

### 2. Playwright 启动失败？

```bash
# 安装浏览器
npx playwright install chromium

# 或使用 pnpm
pnpm exec playwright install chromium
```

### 3. 端口冲突？

修改 `config/default.json` 中的 `server.port`：

```json
{
  "server": {
    "port": 3001  // 改为其他端口
  }
}
```

### 4. Desktop 应用无法启动？

确保已安装依赖：
```bash
cd desktop && pnpm install
```

如果还有问题，尝试重新构建：
```bash
pnpm build:all
```

### 5. 服务启动慢？

如果启动时需要等待较长时间，可以禁用启动预检：

```json
{
  "webdriver": {
    "startup_preflight_enabled": false
  }
}
```

### 6. Forward 模式无法使用？

确保在配置中正确设置了 `forward` 相关参数：
- `base_url`: API 端点地址
- `api_key`: 有效的 API 密钥

### 7. 流式响应不显示？

Forward Monitor 支持流式响应的实时显示。如果遇到问题：
1. 检查浏览器控制台是否有错误
2. 确认 SSE 连接是否建立成功
3. 查看服务端日志（`.data/logs/`）

### 8. Session 管理在哪里？

- Web 界面：访问 `http://127.0.0.1:3000/monitor`
- 桌面应用：切换到 "Forward Monitor" 标签页
- API：使用 `/v1/forward-monitor/sessions` 端点

## 开发

### 添加新 Provider

1. **配置文件**：在 `config/default.json` 添加配置
   ```json
   {
     "providers": {
       "new-provider": {
         "default_mode": "web",
         "models": ["model-1"],
         "web": {
           "site": "https://new-provider.com/",
           "input_max_chars": 120000
         }
       }
     }
   }
   ```

2. **Web Driver**：在 `src/web-driver/` 创建对应的 driver 文件（如需自定义逻辑）

3. **协议解析**：在 `src/protocol/` 添加协议解析逻辑（如需特殊处理）

4. **桌面端集成**：更新 `desktop/electron/provider-sites.ts`（如需桌面端支持）

### 模式切换

项目支持两种运行模式：

- **Web 模式**：通过 Playwright 自动化操作 Web 界面
  - 优点：无需 API Key，可使用免费版或订阅版
  - 缺点：速度较慢，依赖浏览器

- **Forward 模式**：直接转发请求到上游 API
  - 优点：速度快，稳定性高
  - 缺点：需要有效的 API Key

可以通过配置的 `default_mode` 设置默认模式，或在请求时通过参数指定。

### 调试

```bash
# 服务端日志
pnpm dev  # 控制台输出

# 查看日志文件
tail -f .data/logs/webclaw-proxy-*.log

# 桌面端日志
pnpm dev:desktop  # 查看 Logs 标签页

# 启用调试模式
# 在 config/default.json 中设置
{
  "logging": {
    "debug": true
  }
}
```

### 测试

```bash
# 运行所有测试
pnpm test

# 单独测试模块
pnpm test:web-driver     # Web Driver 测试
pnpm test:protocol       # 协议解析测试
pnpm test:controller     # 控制器测试
pnpm test:data-manager   # 数据管理测试

# 运行测试脚本
pnpm script:all          # 运行所有测试脚本
pnpm script:web-driver   # Web Driver 测试脚本
pnpm script:protocol     # 协议解析测试脚本
```

### 项目架构

```
src/
├── controller/             # 路由和控制器
│   ├── index.ts           # 服务入口
│   ├── server.ts          # Express 服务器
│   ├── session-registry.ts # Session 管理
│   ├── forward-monitor-bus.ts # 事件总线
│   └── routes/            # API 路由
├── web-driver/            # Playwright 自动化
│   ├── WebDriverManager.ts
│   └── providers/         # 各 Provider 驱动
├── protocol/              # 协议解析
│   ├── openai.ts          # OpenAI 协议
│   └── sse.ts             # SSE 协议
├── data-manager/          # 数据管理
└── conversation/          # 会话管理

desktop/
├── electron/              # Electron 主进程
│   ├── main.ts           # 主入口
│   └── provider-sites.ts # Provider 站点配置
└── src/                  # React 渲染进程
    ├── App.tsx           # 主组件
    ├── panels/           # 功能面板
    └── components/       # UI 组件
```

## 许可证

MIT License

Copyright (c) 2024 fuguoheng

## 贡献

欢迎提交 Issue 和 Pull Request！

## 相关链接

- [OpenAI API 文档](https://platform.openai.com/docs/api-reference)
- [Playwright 文档](https://playwright.dev/)
- [Electron 文档](https://www.electronjs.org/)
