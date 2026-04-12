import * as crypto from 'crypto';
import { Message, Tool } from '../../protocol/types';

/**
 * 计算字符串的 SHA256 哈希值（取前 16 位）
 */
function sha256Short(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex').substring(0, 16);
}

/**
 * 计算 system 提示词的 hash
 */
export function computeSystemHash(system: string): string {
  return sha256Short(system);
}

/**
 * 计算 history 列表的 rolling hash
 * 仅纳入 role=user 的消息：hash = sha256(hash + canonicalize(message))
 */
export function computeHistoryHash(history: Message[]): string {
  const userMessages = history.filter((msg) => msg.role === 'user');
  if (userMessages.length === 0) {
    return sha256Short('');
  }

  let rollingHash = '';
  for (const msg of userMessages) {
    const canonical = canonicalizeMessage(msg);
    rollingHash = sha256Short(rollingHash + canonical);
  }
  return rollingHash;
}

/**
 * 计算 tools 列表的 hash
 * 1. 先按 function.name 排序
 * 2. 序列化为 canonical JSON
 * 3. 计算 SHA256
 */
export function computeToolsHash(tools: Tool[]): string {
  if (tools.length === 0) {
    return sha256Short('');
  }

  const sorted = [...tools].sort((a, b) =>
    (a.function?.name ?? '').localeCompare(b.function?.name ?? '')
  );

  const canonical = JSON.stringify(sorted);
  return sha256Short(canonical);
}

/**
 * 计算完整的 HASH_KEY
 * 格式：systemHash_historyHash_toolsHash
 */
export function computeHashKey(
  system: string,
  history: Message[],
  tools: Tool[]
): string {
  const systemHash = computeSystemHash(system);
  const historyHash = computeHistoryHash(history);
  const toolsHash = computeToolsHash(tools);
  return `${systemHash}_${historyHash}_${toolsHash}`;
}

/**
 * 将消息对象序列化为规范化字符串（用于 hash 计算）
 */
function canonicalizeMessage(msg: Message): string {
  // 对 content 进行规范化处理
  let content: unknown;
  if (typeof msg.content === 'string') {
    content = msg.content;
  } else if (Array.isArray(msg.content)) {
    // 数组格式：保持原始顺序（对话顺序敏感）
    content = msg.content;
  } else {
    content = msg.content ?? '';
  }

  const tool_calls = Array.isArray(msg.tool_calls)
    ? msg.tool_calls.map((tc) => ({
        index: tc.index,
        id: tc.id,
        type: tc.type,
        function: tc.function,
      }))
    : undefined;

  return JSON.stringify({ role: msg.role, content, tool_calls });
}
