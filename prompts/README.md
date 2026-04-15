# Prompts Directory

这个目录用于存放可复用的提示词文件，以及默认输出格式/重试规则模板。

## 引用语法

你可以在 `config/default.json` 的任意字符串值中使用：

```text
[[system/system1.md]]
```

加载配置时会自动把它展开为 `prompts/` 目录下对应文件的内容。

## 示例

```json
{
  "defaults": {
    "init_prompt": "下面是系统提示词\n[[system/system1.md]]"
  }
}
```

如果 `prompts/system/system1.md` 内容为：

```md
你是一个严格输出 JSON 的助手。
不要输出额外解释。
```

那么实际得到的字符串就是：

```text
下面是系统提示词
你是一个严格输出 JSON 的助手。
不要输出额外解释。
```

## 常见用途

当前项目里最常见的引用点有：

- `defaults.init_prompt_template`
- `defaults.format_only_retry_template`
- `defaults.response_schema_template`

例如：

- `[[output_template.json]]`
- `[[retry_template.md]]`
- `[[system/system1.md]]`

## 模板占位符

加载完 `[[...]]` 文件引用后，部分模板还会继续做变量替换。

当前默认支持的占位符包括：

- `{{init_prompt}}`
- `{{response_schema_template}}`
- `{{system_prompt}}`
- `{{tools_prompt}}`
- `{{history_prompt}}`
- `{{content}}`

其中：

- `init_prompt_template` 主要会使用前五个
- `user_message_template` 主要会使用 `{{content}}`
- `format_only_retry_template` 主要会使用 `{{response_schema_template}}`

## 说明

- 只允许引用 `prompts/` 目录内的文件
- 支持在被引用文件内继续使用 `[[...]]` 递归引用
- 如果出现循环引用，会直接抛错
- `[[...]]` 引用展开发生在配置加载阶段
- `{{...}}` 占位符替换发生在运行时构造 prompt 阶段
