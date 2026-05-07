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

编辑 `config/default.json`，配置你的 AI Providers，使用 web 模式不需要配置 api_key

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

### 3. 启动服务

启动后请在打开的浏览器页面进行登录（Web 模式），登录后才能使用对应 AI 服务商。

#### 方式一：TUI 命令行模式（推荐）

```bash
npm run dev:tui
```

一键启动 Proxy + Agent Service + TUI，Ctrl-C 关闭全部。  
后台服务日志写入 `.logs/`，TUI 独占终端，交互界面不被日志打断。

#### 方式二：桌面应用模式

```bash
# 开发模式（热重载）
npm run dev:desktop

# 生产模式
npm run build:all
npm run start:desktop
```

桌面应用提供：
- 可视化服务启动/停止控制
- 多 Provider Web 界面切换
- Forward Monitor 实时监控
- 内置终端和日志查看

#### 方式三：仅启动代理服务

```bash
# 开发模式
npm run dev

# 生产模式
npm run build
npm run start
```

服务将在 `http://127.0.0.1:3000` 启动。

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

## 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                     用户界面层 (UI Layer)                      │
│                                                              │
│  Desktop (Electron + React)      TUI (Node.js + readline)    │
│  图形化桌面客户端                  命令行交互客户端               │
│  HTTP + WebSocket                HTTP + WebSocket            │
└─────────────────────┬────────────────────┬───────────────────┘
                      │                    │
                      ▼                    ▼
┌──────────────────────────────────────────────────────────────┐
│               Agent Service (client-core/src/server/)         │
│                      默认端口 :8100                            │
│                                                              │
│  SessionManager ──► AgentSession ──► WebClawClientCore       │
│  (多会话管理)         (单会话包装)      (Tool Loop 核心逻辑)     │
│  FileSessionStore                   内置工具：browser/exec/   │
│  (~/.webclaw/sessions)              read-file/web-search 等  │
│                                                              │
│  REST API:  POST /v1/chat   GET /v1/sessions  PATCH /v1/config│
│  WebSocket: ws://localhost:8100/ws  (实时事件推送)             │
└─────────────────────────────┬────────────────────────────────┘
                              │  HTTP POST /v1/chat/completions
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                  WebClawProxy (src/)                          │
│                    默认端口 :3000                              │
│                                                              │
│  ┌─────────────────────┐    ┌──────────────────────────────┐ │
│  │     Web 模式         │    │        Forward 模式           │ │
│  │  Playwright/CDP      │    │  透明转发到上游 OpenAI API    │ │
│  │  驱动真实 Chromium   │    │  SessionRegistry 会话管理    │ │
│  │  操作 ChatGPT/Claude │    │  SSE Forward Monitor        │ │
│  │  /DeepSeek 等网站    │    │                              │ │
│  └─────────────────────┘    └──────────────────────────────┘ │
│                                                              │
│  OpenAI 兼容接口：POST /v1/chat/completions                   │
│  管理接口：/v1/models  /v1/providers  /v1/conversations       │
│  监控界面：/monitor                                           │
└──────────────────────────────────────────────────────────────┘
```

**数据流向**：
```
用户输入 → Desktop / TUI
         → Agent Service (:8100)  [处理命令、管理会话]
         → WebClawClientCore      [Tool Loop 自动循环执行工具]
         → WebClawProxy (:3000)   [路由分发]
         → Web 模式: Playwright 驱动浏览器访问 AI 网站
         → Forward 模式: 直接调用上游 OpenAI 兼容 API
```

## 项目结构

```
WebClawProxy/
├── config/              # 配置文件目录
│   └── default.json     # 主配置文件
├── src/                 # WebClawProxy 代理服务（端口 3000）
│   ├── controller/      # API 路由、会话注册、Forward Monitor
│   ├── web-driver/      # Playwright 浏览器自动化
│   ├── data-manager/    # 数据管理
│   └── protocol/        # 协议解析（OpenAI 格式）
├── client-core/         # 客户端核心库 + Agent Service
│   └── src/
│       ├── core/        # WebClawClientCore（Tool Loop 核心）
│       │   └── tools/   # 内置工具（browser/exec/web-search 等）
│       ├── server/      # Agent Service（端口 8100）
│       └── shared/      # 共享类型定义
├── desktop/             # Electron 桌面客户端
│   ├── electron/        # Electron 主进程（服务管理、CDP）
│   └── src/             # React 渲染进程（聊天面板、监控界面）
├── tui/                 # 命令行交互客户端
│   └── src/             # ChatCLI + AgentClient
├── scripts/             # 开发脚本
│   └── dev-tui.sh       # TUI 一键启动脚本
├── tests/               # 测试用例
├── docs/                # 文档
└── pnpm-workspace.yaml  # pnpm workspace 配置
```

## 可用命令

### 启动方式汇总

| 命令 | 说明 |
|------|------|
| `npm run dev` | 仅启动 WebClawProxy 代理服务（端口 3000） |
| `npm run dev:desktop` | 一键启动桌面应用（含代理服务） |
| `npm run dev:tui` | 一键启动 TUI 客户端（proxy + agent + tui） |

### TUI 一键启动（推荐）

```bash
npm run dev:tui
```

启动流程：
1. 后台启动 WebClawProxy（日志写入 `.logs/proxy.log`）
2. 后台启动 Agent Service（日志写入 `.logs/agent.log`）
3. 前台运行 TUI 终端界面（独占终端，不被后台日志打断）
4. Ctrl-C 时自动关闭所有后台进程

```bash
# 查看后台服务日志（可另开终端）
tail -f .logs/proxy.log
tail -f .logs/agent.log
```

### 根目录命令

```bash
# 开发
npm run dev              # 启动 WebClawProxy（开发模式）
npm run build            # 编译 TypeScript
npm run start            # 启动服务（生产模式）

# 测试
npm run test             # 运行所有测试
npm run test:web-driver  # 测试 Web Driver
npm run test:protocol    # 测试协议解析
npm run test:controller  # 测试控制器
```

### Desktop（桌面应用）

```bash
# 开发
npm run dev:desktop      # 启动桌面应用（开发模式，含代理服务）
npm run build:desktop    # 编译桌面应用
npm run start:desktop    # 启动桌面应用（生产模式）
npm run build:all        # 编译服务端 + 桌面端
```

### TUI 内置命令

在 TUI 交互界面中可使用以下命令：

```
/help              显示帮助
/model <名称>      切换模型（如 /model gpt-4o）
/mode <web|forward> 切换路由模式
/new               新建会话
/sessions          列出所有会话
/session           显示当前会话信息
/clear             清空当前对话
/config            查看当前配置
/tools             查看可用工具列表
/quit              退出
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

1. 在 `config/default.json` 添加配置
2. 在 `src/web-driver/` 创建对应的 driver 文件
3. 在 `src/protocol/` 添加协议解析逻辑
4. 更新 `desktop/electron/provider-sites.ts`

### 调试

```bash
# 服务端日志
pnpm dev  # 控制台输出

# 桌面端日志
pnpm dev:desktop  # 查看 Logs 标签页
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
