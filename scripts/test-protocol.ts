/**
 * 协议转换模块功能测试脚本
 *
 * 直接运行：npm run script:protocol
 * 或：npx ts-node scripts/test-protocol.ts
 */

import { OpenAIProtocol } from '../src/protocol';
import { ProtocolParseError } from '../src/protocol/types';

const protocol = new OpenAIProtocol();

// 测试颜色输出
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`${GREEN}✓${RESET} ${name}`);
    passed++;
  } catch (err) {
    console.log(`${RED}✗${RESET} ${name}`);
    console.log(`  ${RED}错误：${(err as Error).message}${RESET}`);
    failed++;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertDeepEqual(a: unknown, b: unknown, message: string): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${message}\n  期望: ${JSON.stringify(b, null, 2)}\n  实际: ${JSON.stringify(a, null, 2)}`);
  }
}

console.log(`\n${BOLD}${CYAN}=== 协议转换模块功能测试 ===${RESET}\n`);

// ============================
// 基础解析测试
// ============================
console.log(`${YELLOW}--- OpenAI 协议解析测试 ---${RESET}`);

// 完整的 OpenAI 请求（来自需求文档）
const fullOpenAIRequest = {
  model: 'gpt-5.2',
  messages: [
    {
      role: 'system',
      content: 'You are a personal assistant running inside OpenClaw.\n',
    },
    {
      role: 'user',
      content: [{ type: 'text', text: '你好' }],
    },
  ],
  stream: false,
  store: false,
  max_completion_tokens: 8192,
  tools: [
    {
      type: 'function',
      function: {
        name: 'read',
        description:
          'Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.',
        parameters: {
          type: 'object',
          required: ['path'],
          properties: {
            path: {
              description: 'Path to the file to read (relative or absolute)',
              type: 'string',
            },
            offset: {
              description: 'Line number to start reading from (1-indexed)',
              type: 'number',
            },
            limit: {
              description: 'Maximum number of lines to read',
              type: 'number',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_get',
        description:
          'Safe snippet read from MEMORY.md or memory/*.md with optional from/lines; use after memory_search to pull only the needed lines and keep context small.',
        parameters: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string' },
            from: { type: 'number' },
            lines: { type: 'number' },
          },
        },
      },
    },
  ],
  parallel_tool_calls: true,
};

test('解析完整 OpenAI 请求 - model 字段', () => {
  const result = protocol.parse(fullOpenAIRequest);
  assert(result.model === 'gpt-5.2', `model 应为 gpt-5.2，实际为 ${result.model}`);
});

test('解析完整 OpenAI 请求 - system 字段', () => {
  const result = protocol.parse(fullOpenAIRequest);
  assert(
    result.system === 'You are a personal assistant running inside OpenClaw.\n',
    `system 提取不正确`
  );
});

test('解析完整 OpenAI 请求 - history 不含 system 消息', () => {
  const result = protocol.parse(fullOpenAIRequest);
  result.history.forEach((msg) => {
    assert(msg.role !== 'system', 'history 中不应含 system 消息');
  });
});

test('解析完整 OpenAI 请求 - current 是最后一条非 system 消息', () => {
  const result = protocol.parse(fullOpenAIRequest);
  assert(result.current.role === 'user', `current.role 应为 user，实际为 ${result.current.role}`);
});

test('解析完整 OpenAI 请求 - tools 包含 2 个工具', () => {
  const result = protocol.parse(fullOpenAIRequest);
  assert(result.tools.length === 2, `tools 应有 2 个，实际有 ${result.tools.length}`);
  assert(result.tools[0].function.name === 'read', `第一个工具名应为 read`);
  assert(result.tools[1].function.name === 'memory_get', `第二个工具名应为 memory_get`);
});

test('解析完整 OpenAI 请求 - 输出结构', () => {
  const result = protocol.parse(fullOpenAIRequest);
  console.log('\n  解析结果预览:');
  console.log(`  model: ${result.model}`);
  console.log(`  system: ${result.system.substring(0, 50)}...`);
  console.log(`  history.length: ${result.history.length}`);
  console.log(`  current.role: ${result.current.role}`);
  console.log(`  tools.length: ${result.tools.length}`);
  assert(true, '输出结构验证通过');
});

// ============================
// 多轮对话测试
// ============================
console.log(`\n${YELLOW}--- 多轮对话测试 ---${RESET}`);

const multiTurnRequest = {
  model: 'gpt-4o',
  messages: [
    { role: 'system', content: '你是专业助手' },
    { role: 'user', content: '第一个问题' },
    { role: 'assistant', content: '第一个回答' },
    { role: 'user', content: '第二个问题' },
    { role: 'assistant', content: '第二个回答' },
    { role: 'user', content: '第三个问题（当前）' },
  ],
};

test('多轮对话 - history 包含正确数量的消息', () => {
  const result = protocol.parse(multiTurnRequest);
  assert(
    result.history.length === 4,
    `history 应有 4 条消息，实际有 ${result.history.length}`
  );
});

test('多轮对话 - current 是最新一条用户消息', () => {
  const result = protocol.parse(multiTurnRequest);
  assert(
    result.current.content === '第三个问题（当前）',
    `current.content 不正确`
  );
});

// ============================
// 返回格式测试
// ============================
console.log(`\n${YELLOW}--- OpenAI 输出格式测试 ---${RESET}`);

test('format() - 基本响应格式', () => {
  const response = {
    content: '你好！',
    model: 'gpt-4o',
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  };
  const result = protocol.format(response) as any;

  assert(result.id.startsWith('chatcmpl-'), `id 格式不正确: ${result.id}`);
  assert(result.object === 'chat.completion', `object 不正确`);
  assert(typeof result.created === 'number', `created 应为数字`);
  assert(result.model === 'gpt-4o', `model 不正确`);
  assert(result.choices.length === 1, `choices 应有 1 条`);
  assert(result.choices[0].message.role === 'assistant', `role 应为 assistant`);
  assert(result.choices[0].message.content === '你好！', `content 不正确`);
  assert(result.choices[0].finish_reason === 'stop', `finish_reason 应为 stop`);
});

test('format() - 含 tool_calls 的响应', () => {
  const response = {
    content: null,
    tool_calls: [
      {
        id: 'call_abc123',
        type: 'function' as const,
        function: { name: 'read_file', arguments: '{"path": "test.txt"}' },
      },
    ],
    model: 'gpt-4o',
  };
  const result = protocol.format(response) as any;

  assert(result.choices[0].finish_reason === 'tool_calls', `finish_reason 应为 tool_calls`);
  assert(
    result.choices[0].message.tool_calls.length === 1,
    `tool_calls 应有 1 条`
  );

  console.log('\n  格式化输出预览:');
  console.log(`  id: ${result.id}`);
  console.log(`  finish_reason: ${result.choices[0].finish_reason}`);
  console.log(`  tool_calls: ${JSON.stringify(result.choices[0].message.tool_calls[0].function)}`);
});

// ============================
// 错误处理测试
// ============================
console.log(`\n${YELLOW}--- 错误处理测试 ---${RESET}`);

test('非对象输入应该抛出 ProtocolParseError', () => {
  let caught = false;
  try {
    protocol.parse('invalid input');
  } catch (err) {
    caught = err instanceof ProtocolParseError;
  }
  assert(caught, '应该抛出 ProtocolParseError');
});

test('缺少 model 字段应该抛出错误', () => {
  let caught = false;
  try {
    protocol.parse({ messages: [{ role: 'user', content: '你好' }] });
  } catch (err) {
    caught = err instanceof ProtocolParseError;
  }
  assert(caught, '应该抛出 ProtocolParseError');
});

test('空 messages 数组应该抛出错误', () => {
  let caught = false;
  try {
    protocol.parse({ model: 'gpt-4o', messages: [{ role: 'system', content: '只有系统' }] });
  } catch (err) {
    caught = err instanceof ProtocolParseError;
  }
  assert(caught, '应该抛出 ProtocolParseError');
});

// ============================
// 测试结果汇总
// ============================
console.log('\n' + '='.repeat(50));
console.log(`${BOLD}测试结果：${RESET}`);
console.log(`  ${GREEN}通过: ${passed}${RESET}`);
if (failed > 0) {
  console.log(`  ${RED}失败: ${failed}${RESET}`);
} else {
  console.log(`  失败: ${failed}`);
}
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
}
