# 数据管理模块（`data-manager`）

## 1. 模块职责

`data-manager` 负责三件事：

1. **会话映射**：把一次请求（`model + system + history + tools`）映射到唯一磁盘目录。  
2. **状态持久化**：保存 `system`、`history`、`tools`、`web_url`、`linked` 等状态。  
3. **Prompt 构造**：为控制层提供 `init_prompt`、`current_prompt`、`format_only_retry_prompt`。

对应核心实现：`src/data-manager/DataManager.ts`

---

## 2. 目录结构与命名

默认根目录来自 `config/default.json` 的 `data.root_dir`（默认 `./data`）。

当前真实结构由两部分组成：

```text
data/
├── session-index/
│   └── {category}/
│       └── {model}.json        # hash -> sessionDir -> web_urls/linked 映射
└── {category}/
    └── {model}/
        └── {sessionDir}/       # 稳定会话目录名，不再直接使用 HASH_KEY 命名
            ├── system          # 系统提示词文本
            ├── history.jsonl   # 对话历史，每行一个 JSON Message
            └── tools.json      # 工具列表（按 function.name 排序后写入）
```

`category` 的计算逻辑：
- 优先使用配置中的 `models` 映射（`findModelCategory`）
- 找不到时降级为 `model.toLowerCase().replace(/[^a-z0-9]/g, '_')`

---

## 3. HASH_KEY 规则（当前真实实现）

实现文件：`src/data-manager/utils/hash.ts`

### 3.1 组成

`HASH_KEY = {systemHash}_{historyHash}_{toolsHash}`

- `systemHash`：`sha256(system)` 取前 16 位
- `historyHash`：rolling hash（按历史顺序累积）
- `toolsHash`：按 `function.name` 排序后 JSON 序列化再 hash

### 3.2 关键原则

- **history 必须参与 hash**（避免不同会话被错误复用）
- `tools` 的顺序差异不会影响 hash（已排序）

---

## 4. DataManager 生命周期

实现文件：`src/data-manager/DataManager.ts`

## 4.1 构造

```ts
new DataManager(internalReq, customConfig?)
```

构造时会：
1. 复制 `model/system/history/tools/current`
2. 组装配置（优先 `customConfig`，否则 `config/default.json`）
3. 调用 `update_hash_key()` 计算初始 `HASH_KEY` 与 `DATA_PATH`

## 4.2 `save_data()`

当前实现是**统一路径**（不再区分文档中的 A/B 双路径）：

1. 记录当前 `oldHash`，并判断调用前 `history` 中是否已存在 user 消息。
2. 若 `current` 与 `history` 尾项不同，则先将 `current` 追加到内存 `history`（尾项去重）。
3. 以更新后的 `history` 调用 `update_hash_key()`，推进到新 hash：
   - 非首轮（原始 history 已有 user）会继承旧 hash 的 session 链路。
   - 首轮（原始 history 无 user）会强制新建 session，避免同首句命中旧会话。
4. 在稳定的 `DATA_PATH` 下全量落盘：
   - `system`
   - `history.jsonl`（写入**已并入 current 的 history**）
   - `tools.json`

> 结论：`save_data()` 会把 `current` 归档进 `history` 后再保存（若未重复）。

---

## 5. 链接状态管理

当前真实实现不再依赖 `DATA_PATH/web_url` 与 `DATA_PATH/linked` 两个单文件，而是统一记录在：

```text
data/session-index/{category}/{model}.json
```

索引结构核心字段：

- `sessions[sessionDir].latest_hash`
- `sessions[sessionDir].web_urls`
- `sessions[sessionDir].linked`
- `latest_hash_to_session[hash]`

### 5.1 `is_linked()`
返回 `true` 条件：
- 当前 `HASH_KEY` 能在 `session-index` 中找到对应 `sessionDir`
- 该 `sessionDir` 的 `linked === true`
- `web_urls.length > 0`

### 5.2 `update_web_url(url)`
- 将新的网页会话 URL 追加到当前 `HASH_KEY` 对应 session 的 `web_urls`
- 同时将该 session 标记为 `linked = true`
- `get_web_url()` 会始终读取 `web_urls` 的最后一项

### 5.3 `get_web_url()`
- 从当前 `HASH_KEY -> sessionDir -> web_urls` 取最后一个 URL
- 若不存在映射或 `web_urls` 为空，则返回空字符串

### 5.4 `cancel_linked()`
- 不删除历史 `web_urls`
- 仅把当前 `HASH_KEY` 对应 session 的 `linked` 置为 `false`
- 作用：当控制层发现当前 `sessionUrl` 失效时，让**下一次请求**重新执行网页初始化

### 5.5 什么时候会切换到新 session？

先区分两个概念：

- **hash 变化**：表示 `system + history + tools` 的上下文发生了变化
- **session 切换**：表示网页端需要使用新的对话 URL

两者**不完全等价**。

#### 情况 A：首轮保存时强制新建 session

在 `save_data()` 中，如果调用前的原始 `history` 里还没有 `user` 消息：

- 会执行 `update_hash_key({ forceNewSession: true })`
- 强制绑定新的 `sessionDir`
- 目的：避免两个“首句相同”的全新请求误命中旧会话

#### 情况 B：正常多轮推进时继承旧 session

在 `save_data()` 中，如果调用前的原始 `history` 已经包含 `user` 消息：

- 会执行 `update_hash_key({ inheritFromHash: oldHash })`
- 新 hash 会继承旧 hash 的 `sessionDir`
- 结果：上下文虽然推进了，但仍沿用原 session 映射

#### 情况 C：控制层要求切新网页会话

`DataManager` 本身并不会主动决定“何时切新网页 URL”，真正触发切换的是控制层：

- 当前 `!dm.is_linked()`，需要初始化新网页会话
- 已链接但 usage 超过 `context_switch` 阈值，控制层主动新建网页会话
- 已链接但旧 `sessionUrl` 失效，控制层会 `dm.cancel_linked()`，下一次请求再重建

因此可以理解为：

- `DataManager` 负责维护“hash -> sessionDir -> web_urls/linked”的映射
- `controller` 负责决定“这次请求到底是继续复用，还是新建网页会话”

---

## 6. Prompt 相关接口

实现文件：`src/data-manager/utils/prompt.ts`

## 6.1 `get_system_prompt()`
格式：

```text
<system>
{system}
</system>
```

## 6.2 `get_history_prompt()`

当前真实实现会输出：

```text
<history>
<user>
...
</user>
<assistant>
...
<tool_call id="call_xxx">
name: exec
arguments: {"command":"ls"}
</tool_call>
</assistant>
<tool id="call_xxx">
...
</tool>
</history>
```

规则：

- `history` 外层会包一层 `<history> ... </history>`
- `user` / `assistant` / `tool` 都会输出成对闭合标签
- assistant 如果带 `tool_calls`，会在内容后追加一个或多个 `<tool_call ...> ... </tool_call>`
- `role=tool` 会输出 `<tool id="..."> ... </tool>`

其中 `content` 的构造规则：

- `type === "text"`：直接拼接 `text`
- `type !== "text"`：按 `[type] + JSON(rest)` 形式拼接，`rest` 为去掉 `type` 后的全部字段
- 例如 `tool_result` 会包含 `tool_call_id`、`content` 等全部信息

## 6.3 `get_current_prompt()`

当前逻辑分两类：

- 若 `current` 只有一条 `user`，且不含 `tool_calls`
  - 直接返回纯文本内容，不包 `<user>`
- 其他情况
  - 按与 history 一致的 wrapper 结构输出
  - 例如 `<tool> ... </tool>`、`<user> ... </user>`、`<assistant> ... </assistant>`

## 6.4 `get_tools_prompt()`
- 以可读结构列出工具：`Tool i / Name / Description / Parameters`

## 6.5 `get_init_prompt()`
模板变量：
- `{{response_schema_template}}`
- `{{system_prompt}}`
- `{{tools_prompt}}`
- `{{history_prompt}}`

来源：`defaults.init_prompt_template`

## 6.6 `get_format_only_retry_prompt()`
模板变量：
- `{{response_schema_template}}`

来源：`defaults.format_only_retry_template`

用途：用于 JSON 解析失败后的重试提示，仅强调输出格式，不拼接原问题内容。

## 6.7 `get_usage()`

返回结构：

```json
{
  "usage": {
    "prompt_tokens": 21817,
    "completion_tokens": 85,
    "total_tokens": 21902
  }
}
```

计算口径（近似值，非模型真实 tokenizer）：

- `prompt_tokens`：对 `get_init_prompt()` 生成的整段文本进行 token 估算
- `completion_tokens`：对 `current` 做 `JSON.stringify(current)` 后进行 token 估算
- `total_tokens`：`prompt_tokens + completion_tokens`

当前估算规则（工程近似）：
- CJK 字符按 1 token
- 其他非空白字符按 4 字符 ≈ 1 token（向上取整）

> 注意：该值用于粗粒度监控与成本预估，不保证与上游模型官方计费 token 完全一致。

---

## 7. 与控制层的协作关系（关键）

控制层（`src/controller/routes/openai.ts`）典型流程：

1. 协议解析得到 `InternalRequest`
2. `new DataManager(internalReq)`
3. `await dm.save_data()`
4. `if (!dm.is_linked())` 则执行 web 初始化并 `dm.update_web_url(url)`
5. 若已链接但 usage 超过阈值，控制层也可能主动新建 session 并再次 `dm.update_web_url(newUrl)`
6. `sessionUrl = dm.get_web_url()`
7. 发送 `dm.get_current_prompt()` 到网页模型
8. 模型回复后 `dm.update_current(assistantMessage)` + `await dm.save_data()`

这也是 `data-manager` 在运行时最核心的职责边界。

---

## 8. 对外导出

入口：`src/data-manager/index.ts`

导出内容：
- `DataManager`
- `DataManagerConfig` / `DataManagerError` / `DataManagerErrorCode`
- `computeHashKey` / `computeSystemHash` / `computeHistoryHash` / `computeToolsHash`
- `buildSystemPrompt` / `buildHistoryPrompt` / `buildCurrentPrompt` / `buildToolsPrompt` / `buildInitPrompt` / `buildCurrentPromptForWebSend` / `contentToString`

---

## 9. 测试覆盖

测试文件：`tests/data-manager/DataManager.test.ts`

已覆盖重点：
- hash 组成与稳定性
- tools 排序一致性
- 目录与文件写入
- `linked` 状态与 `web_url` 读写
- prompt 构造输出
- 模型分类路径映射

运行：

```bash
npm run test:data-manager
```
