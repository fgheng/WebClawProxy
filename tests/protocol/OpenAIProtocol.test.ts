import { OpenAIProtocol } from '../../src/protocol/openai/OpenAIProtocol';
import { ProtocolParseError } from '../../src/protocol/types';

const protocol = new OpenAIProtocol();

/**
 * OpenAI 协议转换器单元测试
 */
describe('OpenAIProtocol.parse()', () => {
  // 基础测试数据
  const basicRequest = {
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
  };

  it('应该正确提取 model 字段', () => {
    const result = protocol.parse(basicRequest);
    expect(result.model).toBe('gpt-5.2');
  });

  it('应该正确提取 system 字段（聚合所有 system 消息，按原顺序拼接）', () => {
    const result = protocol.parse(basicRequest);
    expect(result.system).toBe('You are a personal assistant running inside OpenClaw.\n');
  });

  it('当第一条消息不是 system 时，system 应该为空字符串', () => {
    const req = {
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: '你好' },
      ],
    };
    const result = protocol.parse(req);
    expect(result.system).toBe('');
  });

  it('应该正确提取 current（最后一条消息）', () => {
    const result = protocol.parse(basicRequest);
    expect(result.current.role).toBe('user');
  });

  it('应移除所有 system 消息并保持 history 相对顺序', () => {
    const req = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: '系统提示词-首条' },
        { role: 'user', content: '第一条' },
        { role: 'system', content: '系统提示词-中间' },
        { role: 'assistant', content: '回复' },
        { role: 'system', content: [{ type: 'text', text: '系统提示词-末尾' }] },
        { role: 'user', content: '第二条' },
      ],
    };
    const result = protocol.parse(req);
    expect(result.system).toBe('系统提示词-首条\n\n系统提示词-中间\n\n系统提示词-末尾');
    expect(result.history).toHaveLength(2);
    expect(result.history[0].role).toBe('user');
    expect(result.history[0].content).toBe('第一条');
    expect(result.history[1].role).toBe('assistant');
    expect(result.history[1].content).toBe('回复');
    expect(result.current.content).toBe('第二条');
  });

  it('history 中不应包含任何 system 消息', () => {
    const req = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'S1' },
        { role: 'user', content: 'u1' },
        { role: 'system', content: 'S2' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u2' },
      ],
    };
    const result = protocol.parse(req);
    expect(result.history.every((m) => m.role !== 'system')).toBe(true);
    expect(result.current.role).toBe('user');
  });

  it('history 应该不包含 current 消息（最后一条已被提取）', () => {
    const req = {
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: '第一条' },
        { role: 'assistant', content: '回复' },
        { role: 'user', content: '最新的一条' }, // 这条应成为 current
      ],
    };
    const result = protocol.parse(req);
    expect(result.history).toHaveLength(2);
    expect(result.current.content).toBe('最新的一条');
  });

  it('多轮消息在移除 system 后应保持相对顺序', () => {
    const req = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'S0' },
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
        { role: 'system', content: 'S1' },
        { role: 'user', content: 'u2' },
        { role: 'assistant', content: 'a2' },
        { role: 'user', content: 'u3-current' },
      ],
    };

    const result = protocol.parse(req);
    expect(result.history.map((m) => `${m.role}:${String(m.content)}`)).toEqual([
      'user:u1',
      'assistant:a1',
      'user:u2',
      'assistant:a2',
    ]);
    expect(result.current.role).toBe('user');
    expect(result.current.content).toBe('u3-current');
  });

  it('应该正确提取 tools 字段', () => {
    const req = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: '你好' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
        },
      ],
    };
    const result = protocol.parse(req);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].function.name).toBe('read_file');
  });

  it('tools 为空时应该返回空数组', () => {
    const result = protocol.parse(basicRequest);
    expect(result.tools).toEqual([]);
  });

  it('应该正确处理完整的 OpenAI 请求（包含所有字段）', () => {
    const fullRequest = {
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
            description: 'Read the contents of a file.',
            parameters: {
              type: 'object',
              required: ['path'],
              properties: {
                path: { description: 'Path to the file', type: 'string' },
                offset: { description: 'Line number to start', type: 'number' },
                limit: { description: 'Max lines to read', type: 'number' },
              },
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'memory_get',
            description: 'Safe snippet read from MEMORY.md',
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

    const result = protocol.parse(fullRequest);

    expect(result.model).toBe('gpt-5.2');
    expect(result.system).toContain('You are a personal assistant');
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0].function.name).toBe('read');
    expect(result.tools[1].function.name).toBe('memory_get');
    expect(result.history).toHaveLength(0); // 所有 system 被移除，user 是 current
    expect(result.current.role).toBe('user');
  });

  it('多轮对话中应该正确切分 history 和 current', () => {
    const req = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: '系统提示词' },
        { role: 'user', content: '第1轮问题' },
        { role: 'assistant', content: '第1轮回答' },
        { role: 'user', content: '第2轮问题' },
        { role: 'assistant', content: '第2轮回答' },
        { role: 'user', content: '第3轮问题（当前）' },
      ],
    };
    const result = protocol.parse(req);

    expect(result.history).toHaveLength(4); // 4条历史（排除system和current）
    expect(result.current.role).toBe('user');
    expect(result.current.content).toBe('第3轮问题（当前）');
  });

  it('content 为字符串格式时应该保持不变', () => {
    const req = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: '这是字符串格式的内容' }],
    };
    const result = protocol.parse(req);
    expect(result.current.content).toBe('这是字符串格式的内容');
  });

  it('content 为 ContentItem 数组时应该保持数组格式', () => {
    const req = {
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '请看这张图' },
            { type: 'image_url', image_url: 'https://example.com/img.jpg' },
          ],
        },
      ],
    };
    const result = protocol.parse(req);
    expect(Array.isArray(result.current.content)).toBe(true);
    const content = result.current.content as any[];
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe('text');
    expect(content[1].type).toBe('image_url');
  });

  it('assistant 消息中的 tool_calls 应该被保留到内部结构', () => {
    const req = {
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: [{ type: 'text', text: '执行 ls' }] },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '开始执行' }],
          tool_calls: [
            {
              index: 0,
              id: 'call_xxx',
              type: 'function' as const,
              function: {
                name: 'exec',
                arguments: '{"command":"ls"}',
              },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_call_id: 'call_xxx',
              content: 'a.md',
            },
          ],
        },
      ],
    };

    const result = protocol.parse(req);
    expect(result.history).toHaveLength(2);
    expect(result.history[1].role).toBe('assistant');
    expect(result.history[1].tool_calls).toHaveLength(1);
    expect(result.history[1].tool_calls?.[0].id).toBe('call_xxx');
    expect(result.history[1].tool_calls?.[0].function?.name).toBe('exec');

    const currentContent = result.current.content as any[];
    expect(currentContent[0].type).toBe('tool_result');
    expect(currentContent[0].tool_call_id).toBe('call_xxx');
  });

  it('system 为数组格式时应该提取文本内容', () => {
    const req = {
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: [{ type: 'text', text: '系统提示词内容' }],
        },
        { role: 'user', content: '你好' },
      ],
    };
    const result = protocol.parse(req);
    expect(result.system).toBe('系统提示词内容');
  });

  // ============================
  // 错误处理测试
  // ============================
  describe('错误处理', () => {
    it('输入不是对象时应该抛出 ProtocolParseError', () => {
      expect(() => protocol.parse('not an object')).toThrow(ProtocolParseError);
    });

    it('缺少 model 字段时应该抛出 ProtocolParseError', () => {
      expect(() =>
        protocol.parse({ messages: [{ role: 'user', content: '你好' }] })
      ).toThrow(ProtocolParseError);
    });

    it('messages 不是数组时应该抛出 ProtocolParseError', () => {
      expect(() =>
        protocol.parse({ model: 'gpt-4o', messages: 'not an array' })
      ).toThrow(ProtocolParseError);
    });

    it('messages 全是 system 消息时应该抛出 ProtocolParseError', () => {
      expect(() =>
        protocol.parse({
          model: 'gpt-4o',
          messages: [{ role: 'system', content: '只有系统提示词' }],
        })
      ).toThrow(ProtocolParseError);
    });
  });
});

describe('OpenAIProtocol.format()', () => {
  it('应该返回符合 OpenAI 格式的响应', () => {
    const result = protocol.format(
      'gpt-4o',
      { content: '你好，我是 AI 助手' },
      { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
    ) as any;

    expect(result).toHaveProperty('id');
    expect(result.object).toBe('chat.completion');
    expect(result).toHaveProperty('created');
    expect(result.model).toBe('gpt-4o');
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].message.role).toBe('assistant');
    expect(result.choices[0].message.content).toBe('你好，我是 AI 助手');
    expect(result.choices[0].finish_reason).toBe('stop');
    expect(result.system_fingerprint).toMatch(/^fp_/);
    expect(result.usage.prompt_tokens).toBe(100);
    expect(result.usage.completion_tokens).toBe(20);
    expect(result.usage.total_tokens).toBe(120);
    expect(result.usage.prompt_tokens_details).toEqual({ cached_tokens: 0 });
    expect(result.usage.prompt_cache_hit_tokens).toBe(0);
    expect(result.usage.prompt_cache_miss_tokens).toBe(0);
  });

  it('包含 tool_calls 时 finish_reason 应该是 tool_calls', () => {
    const result = protocol.format(
      'gpt-4o',
      {
        content: undefined as string | undefined,
        tool_calls: [
          {
            id: 'call_123',
            type: 'function' as const,
            function: { name: 'read_file', arguments: '{"path": "test.txt"}' },
          },
        ],
      }
    ) as any;

    expect(result.choices[0].finish_reason).toBe('tool_calls');
    expect(result.choices[0].message.tool_calls).toHaveLength(1);
  });

  it('usage 缺少 total_tokens 时应自动补齐', () => {
    const result = protocol.format(
      'gpt-4o',
      { content: 'hi' },
      { prompt_tokens: 7, completion_tokens: 3 }
    ) as any;
    expect(result.usage.prompt_tokens).toBe(7);
    expect(result.usage.completion_tokens).toBe(3);
    expect(result.usage.total_tokens).toBe(10);
    expect(result.usage.prompt_tokens_details).toEqual({ cached_tokens: 0 });
    expect(result.usage.prompt_cache_hit_tokens).toBe(0);
    expect(result.usage.prompt_cache_miss_tokens).toBe(0);
  });
});
