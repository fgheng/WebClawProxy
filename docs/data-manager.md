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

```text
data/
└── {category}/                 # 由 model 映射的大类（小写）
    └── {model}/                # 具体模型名，如 gpt-4o / deepseek-chat
        └── {HASH_KEY}/         # system + history + tools 计算
            ├── system          # 系统提示词文本
            ├── history.jsonl   # 对话历史，每行一个 JSON Message
            ├── tools.json      # 工具列表（按 function.name 排序后写入）
            ├── web_url         # 对应网页会话 URL（可多行，取最后一行）
            ├── linked          # 链接标记（存在 = 已建立 web 会话映射）
            └── usage.json      # 预留文件（当前未强依赖）
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

## 5.1 `is_linked()`
返回 `true` 条件：
- `DATA_PATH` 存在
- `DATA_PATH/linked` 文件存在

## 5.2 `update_web_url(url)`
- 追加写入 `web_url`
- 创建 `linked` 文件（若不存在）

## 5.3 `get_web_url()`
- 读取 `web_url` 最后一行
- 文件不存在返回空字符串

## 5.4 `cancel_linked()`
- 删除 `linked` 文件

---

## 6. Prompt 相关接口

实现文件：`src/data-manager/utils/prompt.ts`

## 6.1 `get_system_prompt()`
格式：

```text
<|system|>
{system}
```

## 6.2 `get_history_prompt()`
每条消息格式：

```text
<|role:{role}|>
{content}
<|tool_calls|>
[{...tool_call objects...}]   # 仅当该消息包含 tool_calls 时出现
```

其中 `content` 的构造规则：
- `type === "text"`：直接拼接 `text`
- `type !== "text"`：按 `[type] + JSON(rest)` 形式拼接，`rest` 为去掉 `type` 后的全部字段
- 例如 `tool_result` 会包含 `tool_call_id`、`content` 等全部信息

## 6.3 `get_current_prompt()`
- 默认返回 current 的内容文本，不带 role 标记
- 若 current 包含 `tool_calls`，会额外追加：

```text
<|tool_calls|>
[{...tool_call objects...}]
```

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
5. `sessionUrl = dm.get_web_url()`
6. 发送 `dm.get_current_prompt()` 到网页模型
7. 模型回复后 `dm.update_current(assistantMessage)` + `await dm.save_data()`

这也是 `data-manager` 在运行时最核心的职责边界。

---

## 8. 对外导出

入口：`src/data-manager/index.ts`

导出内容：
- `DataManager`
- `DataManagerConfig` / `DataManagerError` / `DataManagerErrorCode`
- `computeHashKey` / `computeSystemHash` / `computeHistoryHash` / `computeToolsHash`
- `buildSystemPrompt` / `buildHistoryPrompt` / `buildCurrentPrompt` / `buildToolsPrompt` / `buildInitPrompt` / `contentToString`

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
