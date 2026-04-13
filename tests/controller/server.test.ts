import request from 'supertest';

const mockInitConversation = jest.fn();
const mockChat = jest.fn();
const mockSendOnly = jest.fn();
const mockOpenBrowser = jest.fn();
const mockClose = jest.fn();

const mockDm = {
  model: 'deepseek-chat',
  system: '',
  history: [],
  tools: [],
  current: { role: 'user', content: '你好' },
  HASH_KEY: 'mock_hash',
  DATA_PATH: '/tmp/mock_data_path',
  save_data: jest.fn(),
  is_linked: jest.fn(),
  get_init_prompt: jest.fn(),
  get_init_prompt_for_new_session: jest.fn(),
  get_current_prompt: jest.fn(),
  get_current_prompt_for_web_send: jest.fn(),
  get_response_schema_template: jest.fn(),
  get_format_only_retry_prompt: jest.fn(),
  get_usage: jest.fn(),
  update_web_url: jest.fn(),
  get_web_url: jest.fn(),
  cancel_linked: jest.fn(),
  update_current: jest.fn(),
  set_trace_id: jest.fn(),
  get_session_debug_info: jest.fn(),
};

jest.mock('../../src/web-driver/WebDriverManager', () => {
  return {
    WebDriverManager: jest.fn().mockImplementation(() => ({
      initConversation: mockInitConversation,
      chat: mockChat,
      sendOnly: mockSendOnly,
      openBrowser: mockOpenBrowser,
      close: mockClose,
    })),
  };
});

jest.mock('../../src/data-manager/DataManager', () => {
  return {
    DataManager: jest.fn().mockImplementation(() => mockDm),
  };
});

const { createApp } = require('../../src/controller/server');
const { OpenAIProtocol } = require('../../src/protocol');

const app = createApp();
const protocol = new OpenAIProtocol();

function buildOpenAIJsonResponse(content = '你好！') {
  return JSON.stringify({
    id: 'chatcmpl-test123',
    object: 'chat.completion',
    created: 1775812436,
    model: 'deepseek-chat',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        logprobs: null,
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
}

beforeEach(() => {
  jest.clearAllMocks();

  mockInitConversation.mockResolvedValue({
    url: 'https://chat.deepseek.com/a/chat/s/mock_session_123',
  });
  mockChat.mockResolvedValue({
    content: buildOpenAIJsonResponse(),
  });
  mockOpenBrowser.mockResolvedValue(undefined);
  mockSendOnly.mockResolvedValue(undefined);
  mockClose.mockResolvedValue(undefined);

  mockDm.model = 'deepseek-chat';
  mockDm.system = '';
  mockDm.history = [];
  mockDm.tools = [];
  mockDm.current = { role: 'user', content: '你好' };
  mockDm.HASH_KEY = 'mock_hash';
  mockDm.DATA_PATH = '/tmp/mock_data_path';
  mockDm.save_data.mockResolvedValue(undefined);
  mockDm.is_linked.mockReturnValue(false);
  mockDm.get_init_prompt.mockReturnValue('初始化 prompt');
  mockDm.get_init_prompt_for_new_session.mockReturnValue('初始化 prompt（不含当前轮）');
  mockDm.get_current_prompt.mockReturnValue('你好');
  mockDm.get_current_prompt_for_web_send.mockReturnValue('你好');
  mockDm.get_response_schema_template.mockReturnValue(
    '{"index":0,"message":{"role":"assistant","content":"文本内容","tool_calls":[]},"logprobs":null,"finish_reason":"stop"}'
  );
  mockDm.get_format_only_retry_prompt.mockReturnValue('仅格式提醒 prompt');
  mockDm.get_usage.mockReturnValue({
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
  mockDm.update_web_url.mockImplementation(() => undefined);
  mockDm.get_web_url.mockReturnValue('https://chat.deepseek.com/a/chat/s/mock');
  mockDm.cancel_linked.mockImplementation(() => undefined);
  mockDm.update_current.mockImplementation(() => undefined);
  mockDm.set_trace_id.mockImplementation(() => undefined);
  mockDm.get_session_debug_info.mockReturnValue({
    hash_key: 'mock_hash',
    data_path: '/tmp/mock_data_path',
    session_dir: '20260412-101010000-mock01',
    linked: false,
    web_url_count: 0,
    latest_web_url: '',
  });
});

describe('控制模块 API 测试', () => {
  const openAIRequest = {
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: '你好' },
    ],
    stream: false,
  };

  describe('GET /health', () => {
    it('应该返回 200 和健康状态', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('GET /v1/models', () => {
    it('应该返回模型列表', async () => {
      const res = await request(app).get('/v1/models');
      expect(res.status).toBe(200);
      expect(res.body.object).toBe('list');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('每个模型应该包含必要字段', async () => {
      const res = await request(app).get('/v1/models');
      const model = res.body.data[0];
      expect(model).toHaveProperty('id');
      expect(model).toHaveProperty('object', 'model');
      expect(model).toHaveProperty('created');
      expect(model).toHaveProperty('owned_by');
    });
  });

  describe('POST /v1/chat/completions', () => {
    it('应该成功处理 OpenAI 格式的请求', async () => {
      const res = await request(app)
        .post('/v1/chat/completions')
        .send(openAIRequest)
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
    });

    it('长输入应按 provider 限长分段发送，且遵循 start/end/all_end 协议', async () => {
      mockDm.model = 'gpt-4o';
      const longPrompt = 'A'.repeat(13050);
      mockDm.get_current_prompt_for_web_send.mockReturnValueOnce(longPrompt);
      mockChat.mockResolvedValueOnce({
        content: buildOpenAIJsonResponse('最后一段的最终回答'),
      });

      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          ...openAIRequest,
          model: 'gpt-4o',
        })
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
      expect(mockSendOnly).toHaveBeenCalledTimes(1);
      expect(mockSendOnly).toHaveBeenCalledWith(
        'gpt',
        'https://chat.deepseek.com/a/chat/s/mock_session_123',
        expect.stringContaining('【分段输入 1/2】')
      );
      expect(mockSendOnly).toHaveBeenCalledWith(
        'gpt',
        'https://chat.deepseek.com/a/chat/s/mock_session_123',
        expect.stringContaining('<|wc_chunk_start:1/2|>')
      );
      expect(mockSendOnly).toHaveBeenCalledWith(
        'gpt',
        'https://chat.deepseek.com/a/chat/s/mock_session_123',
        expect.stringContaining('<|wc_chunk_end:1/2|>')
      );
      expect(mockSendOnly).toHaveBeenCalledWith(
        'gpt',
        'https://chat.deepseek.com/a/chat/s/mock_session_123',
        expect.stringContaining('请仅回复：收到')
      );

      expect(mockChat).toHaveBeenCalledWith(
        'gpt',
        'https://chat.deepseek.com/a/chat/s/mock_session_123',
        expect.stringContaining('【分段输入 2/2】')
      );
      expect(mockChat).toHaveBeenCalledWith(
        'gpt',
        'https://chat.deepseek.com/a/chat/s/mock_session_123',
        expect.stringContaining('<|wc_chunk_start:2/2|>')
      );
      expect(mockChat).toHaveBeenCalledWith(
        'gpt',
        'https://chat.deepseek.com/a/chat/s/mock_session_123',
        expect.stringContaining('<|wc_chunk_end:2/2|>')
      );
      expect(mockChat).toHaveBeenCalledWith(
        'gpt',
        'https://chat.deepseek.com/a/chat/s/mock_session_123',
        expect.stringContaining('<|wc_all_chunks_end|>')
      );
      expect(mockChat).toHaveBeenCalledWith(
        'gpt',
        'https://chat.deepseek.com/a/chat/s/mock_session_123',
        expect.stringContaining('请基于全部分段内容进行正式回答')
      );

      expect(res.body.choices?.[0]?.message?.content).toBe('最后一段的最终回答');
    });

    it('长内容但未分段时，JSON 重试应使用仅格式提醒', async () => {
      mockDm.model = 'deepseek-chat';
      mockDm.get_current_prompt_for_web_send.mockReturnValueOnce('B'.repeat(4001));
      mockChat
        .mockResolvedValueOnce({ content: '这不是 json' })
        .mockResolvedValueOnce({ content: buildOpenAIJsonResponse('格式重试成功') });

      const res = await request(app)
        .post('/v1/chat/completions')
        .send(openAIRequest)
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
      expect(mockDm.get_format_only_retry_prompt).toHaveBeenCalledTimes(1);
      expect(mockChat).toHaveBeenNthCalledWith(
        2,
        'deepseek',
        'https://chat.deepseek.com/a/chat/s/mock_session_123',
        '仅格式提醒 prompt'
      );
    });

    it('短内容 JSON 重试也应仅使用格式提醒模板', async () => {
      mockDm.get_current_prompt_for_web_send.mockReturnValueOnce('短内容');
      mockChat
        .mockResolvedValueOnce({ content: '不是 json' })
        .mockResolvedValueOnce({ content: buildOpenAIJsonResponse('模板重试成功') });

      const res = await request(app)
        .post('/v1/chat/completions')
        .send(openAIRequest)
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
      expect(mockDm.get_format_only_retry_prompt).toHaveBeenCalledTimes(1);
      expect(mockChat).toHaveBeenNthCalledWith(
        2,
        'deepseek',
        'https://chat.deepseek.com/a/chat/s/mock_session_123',
        '仅格式提醒 prompt'
      );
    });

    it('已链接且 usage 超过阈值时应切换到新会话并使用新 URL 发送消息', async () => {
      mockDm.is_linked.mockReturnValueOnce(true);
      mockDm.get_web_url.mockReturnValueOnce('https://chat.deepseek.com/a/chat/s/old_session');
      mockDm.get_usage.mockReturnValueOnce({
        usage: { prompt_tokens: 200000, completion_tokens: 1000, total_tokens: 201000 },
      });
      mockInitConversation.mockResolvedValueOnce({
        url: 'https://chat.deepseek.com/a/chat/s/new_session_456',
      });

      const res = await request(app)
        .post('/v1/chat/completions')
        .send(openAIRequest)
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
      expect(mockInitConversation).toHaveBeenCalledWith(
        'deepseek',
        '初始化 prompt（不含当前轮）'
      );
      expect(mockDm.update_web_url).toHaveBeenCalledWith(
        'https://chat.deepseek.com/a/chat/s/new_session_456'
      );
      expect(mockChat).toHaveBeenCalledWith(
        'deepseek',
        'https://chat.deepseek.com/a/chat/s/new_session_456',
        '你好'
      );
    });

    it('带注释的 JSONC 回复也应识别为 JSON，且不触发模板重试', async () => {
      mockChat.mockResolvedValueOnce({
        content: `{
  "index": 0, // 第几个候选结果
  "message": {
    "role": "assistant",
    "content": "这是 JSONC 回复",
    "tool_calls": []
  },
  "logprobs": null,
  "finish_reason": "stop"
}`,
      });

      const res = await request(app)
        .post('/v1/chat/completions')
        .send(openAIRequest)
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.object).toBe('chat.completion');
      expect(res.body.model).toBe('deepseek-chat');
      expect(res.body.choices?.[0]?.message?.content).toBe('这是 JSONC 回复');
      expect(mockChat).toHaveBeenCalledTimes(1);
    });

    it('带 BOM/零宽字符/行号噪声的 JSON 也应识别成功，且不触发重试', async () => {
      mockChat.mockResolvedValueOnce({
        content: `\uFEFF\u200B\u200D\u200B
1 {
2   "message": {
3     "role": "assistant",
4     "content": "带噪声 JSON",
5     "tool_calls": []
6   },
7   "finish_reason": "stop"
8 }`,
      });

      const res = await request(app)
        .post('/v1/chat/completions')
        .send(openAIRequest)
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.object).toBe('chat.completion');
      expect(res.body.choices?.[0]?.message?.content).toBe('带噪声 JSON');
      expect(mockChat).toHaveBeenCalledTimes(1);
    });

    it('GPT 常见 code fence 噪声（copy code/json 标签）应识别 JSON 且不重试', async () => {
      mockDm.model = 'gpt-4o';
      const gptRequest = {
        ...openAIRequest,
        model: 'gpt-4o',
      };

      mockChat.mockResolvedValueOnce({
        content: `copy code
\`\`\`json
{
  "message": {
    "role": "assistant",
    "content": "GPT JSON 正常",
    "tool_calls": []
  },
  "finish_reason": "stop"
}
\`\`\``,
      });

      const res = await request(app)
        .post('/v1/chat/completions')
        .send(gptRequest)
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.object).toBe('chat.completion');
      expect(res.body.model).toBe('gpt-4o');
      expect(res.body.choices?.[0]?.message?.content).toBe('GPT JSON 正常');
      expect(mockChat).toHaveBeenCalledTimes(1);
    });

    it('非 json 语言标记 code fence（如 ```javascript）包裹 JSON 也应识别', async () => {
      mockDm.model = 'gpt-4o';
      const gptRequest = {
        ...openAIRequest,
        model: 'gpt-4o',
      };

      mockChat.mockResolvedValueOnce({
        content: `\`\`\`javascript
{
  "message": {
    "role": "assistant",
    "content": "JS Fence JSON",
    "tool_calls": []
  },
  "finish_reason": "stop"
}
\`\`\``,
      });

      const res = await request(app)
        .post('/v1/chat/completions')
        .send(gptRequest)
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.choices?.[0]?.message?.content).toBe('JS Fence JSON');
      expect(mockChat).toHaveBeenCalledTimes(1);
    });

    it('Qwen tool_calls 场景：arguments 内嵌 JSON 字符串未转义时也应被修复并解析成功', async () => {
      mockDm.model = 'qwen';
      const qwenRequest = {
        ...openAIRequest,
        model: 'qwen',
        messages: [
          { role: 'user', content: '你好哇哇哇' },
          { role: 'assistant', content: '你好！👋 很高兴见到你～有什么我可以帮你的吗？' },
          {
            role: 'user',
            content:
              '你现在有一个工具可以使用,这个工具定义如下 {"type":"function","function":{"name":"read"}},请帮我阅读一下 downloads/player.txt',
          },
        ],
      };

      mockChat.mockResolvedValueOnce({
        content: `{
  "index": 0,
  "message": {
    "role": "assistant",
    "content": "正在为您读取 downloads/player.txt 文件内容...",
    "tool_calls": [
      {
        "index": 0,
        "id": "callread001",
        "type": "function",
        "function": {
          "name": "read",
          "arguments": "{"path":"downloads/player.txt"}"
        }
      }
    ]
  },
  "logprobs": null,
  "finishreason": "toolcalls"
}`,
      });

      const res = await request(app)
        .post('/v1/chat/completions')
        .send(qwenRequest)
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.object).toBe('chat.completion');
      expect(res.body.model).toBe('qwen');
      expect(res.body.choices?.[0]?.message?.content).toBe('正在为您读取 downloads/player.txt 文件内容...');
      expect(mockChat).toHaveBeenCalledTimes(1);
    });

    it('复杂命令型 tool_calls.arguments（python -c）应解析成功并保留 tool_calls', async () => {
      mockDm.model = 'qwen';
      const qwenRequest = {
        ...openAIRequest,
        model: 'qwen',
      };

      mockChat.mockResolvedValueOnce({
        content: `{
  "index": 0,
  "message": {
    "role": "assistant",
    "content": "我来帮你处理。首先，我会读取这个音频文件并将其转换为文本，然后再发送到指定的邮箱。",
    "tool_calls": [
      {
        "index": 0,
        "id": "call_transcribe_audio",
        "type": "function",
        "function": {
          "name": "exec",
          "arguments": "{\"command\":\"python3 -c \\\"import whisper; model = whisper.load_model('base'); result = model.transcribe('/Users/fgh001/Downloads/a.mp3'); print(result['text'])\\\" > /Users/fgh001/Downloads/a.txt\"}"
        }
      },
      {
        "index": 1,
        "id": "call_send_email",
        "type": "function",
        "function": {
          "name": "exec",
          "arguments": "{\"command\":\"mail -s 'Transcribed Audio' liuxiaohou@gmail.com < /Users/fgh001/Downloads/a.txt\"}"
        }
      }
    ]
  },
  "logprobs": null,
  "finish_reason": "tool_calls"
}`,
      });

      const res = await request(app)
        .post('/v1/chat/completions')
        .send(qwenRequest)
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.object).toBe('chat.completion');
      expect(res.body.model).toBe('qwen');
      expect(res.body.choices?.[0]?.finish_reason).toBe('tool_calls');
      expect(res.body.choices?.[0]?.message?.content).toContain('我来帮你处理');
      expect(res.body.choices?.[0]?.message?.tool_calls).toHaveLength(2);
      expect(res.body.choices?.[0]?.message?.tool_calls?.[0]?.id).toBe('call_transcribe_audio');
      expect(res.body.choices?.[0]?.message?.tool_calls?.[0]?.function?.name).toBe('exec');
      expect(mockDm.update_current).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'assistant',
          tool_calls: expect.any(Array),
        })
      );
      expect(mockChat).toHaveBeenCalledTimes(1);
    });

    it('Qwen 内容字段包含未转义双引号时也应修复并解析成功', async () => {
      mockDm.model = 'qwen';
      const qwenRequest = {
        ...openAIRequest,
        model: 'qwen',
      };

      mockChat.mockResolvedValueOnce({
        content: `{
  "index": 0,
  "message": {
    "role": "assistant",
    "content": "👋 嘿，你好呀！我是 Qwen，"qw 哥"这个称呼我收下啦～ 有什么我可以帮你的吗？",
    "tool_calls": []
  },
  "logprobs": null,
  "finish_reason": "stop"
}`,
      });

      const res = await request(app)
        .post('/v1/chat/completions')
        .send(qwenRequest)
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.object).toBe('chat.completion');
      expect(res.body.model).toBe('qwen');
      expect(res.body.choices?.[0]?.message?.content).toContain('qw 哥');
      expect(mockChat).toHaveBeenCalledTimes(1);
    });

    it('Qwen 首轮回复截断时应触发重试并在二次成功后返回', async () => {
      mockDm.model = 'qwen';
      const qwenRequest = {
        ...openAIRequest,
        model: 'qwen',
      };

      mockChat
        .mockResolvedValueOnce({
          content: '{ "index": 0, "message": { "role"',
        })
        .mockResolvedValueOnce({
          content: `{
  "index": 0,
  "message": {
    "role": "assistant",
    "content": "二次重试后的完整 JSON",
    "tool_calls": []
  },
  "finish_reason": "stop"
}`,
        });

      const res = await request(app)
        .post('/v1/chat/completions')
        .send(qwenRequest)
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.choices?.[0]?.message?.content).toBe('二次重试后的完整 JSON');
      expect(mockChat).toHaveBeenCalledTimes(2);
      expect(mockDm.get_format_only_retry_prompt).toHaveBeenCalledTimes(1);
    });

    it('无效的请求格式应该返回 400', async () => {
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({ invalid: 'request' })
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('缺少 messages 字段应该返回 400', async () => {
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({ model: 'gpt-4o' })
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(400);
    });

    it('遇到额度上限错误时应该直接返回 429，且不做模板重试', async () => {
      mockChat.mockResolvedValueOnce({
        content: 'CLAUDE_4_6 已达到使用额度上限，约 23 小时后刷新，请切换 Auto 或其他模型再试。',
      });

      const res = await request(app)
        .post('/v1/chat/completions')
        .send(openAIRequest)
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(429);
      expect(res.body.error).toMatchObject({
        type: 'rate_limit_error',
        code: 'quota_exceeded',
      });
      expect(res.body.error.message).toContain('已达到使用额度上限');
      expect(mockChat).toHaveBeenCalledTimes(1);
    });

    it('遇到上游服务繁忙时应该返回 503', async () => {
      mockChat.mockResolvedValueOnce({
        content: '服务繁忙，请稍后再试',
      });

      const res = await request(app)
        .post('/v1/chat/completions')
        .send(openAIRequest)
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({
        type: 'service_unavailable',
        code: 'upstream_service_error',
      });
      expect(res.body.error.message).toContain('服务繁忙');
      expect(mockChat).toHaveBeenCalledTimes(1);
    });
  });

  describe('未知路由', () => {
    it('应该返回 404', async () => {
      const res = await request(app).get('/unknown-path');
      expect(res.status).toBe(404);
    });
  });
});

describe('OpenAI 协议解析集成测试', () => {
  it('应该能正确解析复杂请求', () => {
    const complexRequest = {
      model: 'gpt-5.2',
      messages: [
        { role: 'system', content: 'You are a personal assistant.' },
        { role: 'user', content: [{ type: 'text', text: '你好' }] },
        { role: 'assistant', content: '你好，有什么可以帮你？' },
        { role: 'user', content: '请介绍一下你自己' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'read',
            description: 'Read a file',
            parameters: {
              type: 'object',
              required: ['path'],
              properties: { path: { type: 'string' } },
            },
          },
        },
      ],
    };

    const result = protocol.parse(complexRequest);

    expect(result.model).toBe('gpt-5.2');
    expect(result.system).toBe('You are a personal assistant.');
    expect(result.history).toHaveLength(2);
    expect(result.current.content).toBe('请介绍一下你自己');
    expect(result.tools).toHaveLength(1);
  });
});
