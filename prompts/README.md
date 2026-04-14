# Prompts Directory

这个目录用于存放可复用的提示词文件。

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

## 说明

- 只允许引用 `prompts/` 目录内的文件
- 支持在被引用文件内继续使用 `[[...]]` 递归引用
- 如果出现循环引用，会直接抛错
