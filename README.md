# WebClawProxy

将各大 AI 模型 Web 页面封装成标准 OpenAI API 接口的代理服务，支持 ChatGPT、Claude、DeepSeek、Qwen 等多个 AI Provider。

## 特性

- 🚀 **统一 API 接口**：将不同 AI 平台的 Web 界面统一封装为 OpenAI 兼容的 REST API
- 🎯 **Forward Monitor**：实时监控和调试转发的请求/响应，支持 Session 管理
- 🖥️ **桌面应用**：Electron 桌面客户端，提供可视化的服务管理和监控界面
- 🌐 **多 Provider 支持**：ChatGPT / Claude / DeepSeek / Qwen 等
- 🔧 **灵活配置**：支持自定义 Provider、Model、Cookie 等配置

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
    "gpt": {
      "url": "https://chatgpt.com",
      "cookie": "your_chatgpt_cookie_here",
      "model": "gpt-4",
      "default_mode": "web"
    },
    "claude": {
      "url": "https://claude.ai",
      "cookie": "your_claude_cookie_here",
      "model": "claude-3-5-sonnet-20241022",
      "default_mode": "web"
    }
  }
}
```

> 💡 **如何获取 Cookie**：
> 1. 打开浏览器，登录对应的 AI 平台（如 ChatGPT）
> 2. 打开开发者工具（F12）→ Application → Cookies
> 3. 复制所有 Cookie 值（格式：`key1=value1; key2=value2`）

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

```
GET /v1/forward-monitor/events          # SSE 事件流
GET /v1/forward-monitor/sessions        # 获取所有 Session
GET /v1/forward-monitor/sessions/:id    # 获取单个 Session
DELETE /v1/forward-monitor/sessions/:id # 删除 Session
GET /monitor                            # Forward Monitor 页面
```

## 配置说明

### Provider 配置

```json
{
  "providers": {
    "provider_key": {
      "url": "https://example.com",
      "cookie": "session=xxx; auth=yyy",
      "model": "model-name",
      "default_mode": "web",        // 或 "forward"
      "chat_path": "/chat/xxx",     // 可选
      "forward": {
        "api_key": "sk-xxx",        // Forward 模式 API Key
        "base_url": "https://api.example.com"
      }
    }
  }
}
```

### 模式说明

- **web 模式**：通过 Playwright 操作 Web 页面获取响应
- **forward 模式**：直接转发到上游 API（如官方 API）

## 常见问题

### 1. Cookie 过期怎么办？

重新登录对应平台，更新 `config/default.json` 中的 Cookie 值。

### 2. Playwright 启动失败？

```bash
# 安装浏览器
npx playwright install chromium
```

### 3. 端口冲突？

修改 `config/default.json` 中的 `server.port` 和 `cdp.port`。

### 4. Desktop 应用无法启动？

确保已安装依赖：
```bash
cd desktop && pnpm install
```

### 5. 终端不可用？

确保系统有可执行的 shell（`/bin/sh` 或 `/bin/bash`）。

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
