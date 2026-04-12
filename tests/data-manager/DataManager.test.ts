import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DataManager } from '../../src/data-manager/DataManager';
import { InternalRequest } from '../../src/protocol/types';
import { computeHashKey } from '../../src/data-manager/utils/hash';
import {
  buildSystemPrompt,
  buildHistoryPrompt,
  buildCurrentPrompt,
  buildToolsPrompt,
  contentToString,
  buildCurrentPromptForWebSend,
} from '../../src/data-manager/utils/prompt';

/**
 * 数据管理模块单元测试
 */

// 测试用临时目录
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webclaw-test-'));
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================
// Mock 数据
// ============================
const mockRequest: InternalRequest = {
  model: 'gpt-4o',
  system: 'You are a helpful assistant.',
  history: [
    { role: 'user', content: '第一条消息' },
    { role: 'assistant', content: '第一条回复' },
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file',
        parameters: {
          type: 'object',
          required: ['path'],
          properties: { path: { type: 'string', description: 'file path' } },
        },
      },
    },
  ],
  current: { role: 'user', content: '当前消息' },
};

const createTestDataManager = (request: InternalRequest = mockRequest) => {
  return new DataManager(request, {
    rootDir: tmpDir,
    models: {
      GPT: ['gpt-4', 'gpt-4o', 'gpt-4-turbo', 'gpt-5', 'gpt-5.1', 'gpt-5.2'],
      DEEPSEEK: ['deepseek-chat', 'deepseek-r1'],
    },
    jsonTemplate: '{"test": "template"}',
    initPromptTemplate:
      '此次对话的所有回答都必须严格按照下面的json模板进行回复，不能有任何例外:\n{{json_template}}\n\n下面是此次对话的系统提示词，你只需要按约定的回复格式回复"收到"即可.\n{{system_prompt}}\n\n下面是你可以访问的工具：\n{{tools_prompt}}\n\n下面是之前的一些历史对话，仅供参考:\n{{history_prompt}}',
    currentTemplate: '请按照下面的模板回答\n{{json_template}}\n\n---\n{{current}}',
    userMessageTemplate: '',
  });
};

// ============================
// Hash 工具测试
// ============================
describe('Hash 计算工具', () => {
  it('computeHashKey 应该返回格式为 xxx_xxx_xxx 的字符串', () => {
    const key = computeHashKey('system', [], []);
    expect(key).toMatch(/^[a-f0-9]+_[a-f0-9]+_[a-f0-9]+$/);
  });

  it('相同输入应该返回相同的 hash key', () => {
    const key1 = computeHashKey('system', [], []);
    const key2 = computeHashKey('system', [], []);
    expect(key1).toBe(key2);
  });

  it('不同 system 应该返回不同的 hash key', () => {
    const key1 = computeHashKey('system A', [], []);
    const key2 = computeHashKey('system B', [], []);
    expect(key1).not.toBe(key2);
  });

  it('添加历史消息应该改变 hash key', () => {
    const key1 = computeHashKey('system', [], []);
    const key2 = computeHashKey(
      'system',
      [{ role: 'user', content: '你好' }],
      []
    );
    expect(key1).not.toBe(key2);
  });

  it('tools 不同应该改变 hash key', () => {
    const key1 = computeHashKey('system', [], []);
    const key2 = computeHashKey('system', [], [
      {
        type: 'function',
        function: { name: 'test', description: 'test tool' },
      },
    ]);
    expect(key1).not.toBe(key2);
  });

  it('tools 排序不同但内容相同时，hash key 应该相同', () => {
    const tools1 = [
      { type: 'function' as const, function: { name: 'b_tool', description: 'B' } },
      { type: 'function' as const, function: { name: 'a_tool', description: 'A' } },
    ];
    const tools2 = [
      { type: 'function' as const, function: { name: 'a_tool', description: 'A' } },
      { type: 'function' as const, function: { name: 'b_tool', description: 'B' } },
    ];
    const key1 = computeHashKey('system', [], tools1);
    const key2 = computeHashKey('system', [], tools2);
    expect(key1).toBe(key2);
  });

  it('history 中仅 assistant 差异时 hash key 应该相同（仅 user 参与 history hash）', () => {
    const history1 = [
      { role: 'user', content: '同一用户问题' },
      { role: 'assistant', content: 'assistant 版本 A' },
    ] as any;
    const history2 = [
      { role: 'user', content: '同一用户问题' },
      {
        role: 'assistant',
        content: 'assistant 版本 B',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function' as const,
            function: { name: 'exec', arguments: '{"command":"ls"}' },
          },
        ],
      },
    ] as any;

    const key1 = computeHashKey('system', history1, []);
    const key2 = computeHashKey('system', history2, []);
    expect(key1).toBe(key2);
  });

  it('history 中 user 差异时 hash key 应该不同（仅 user 参与 history hash）', () => {
    const history1 = [
      { role: 'user', content: '用户问题 A' },
      { role: 'assistant', content: '回复' },
    ] as any;
    const history2 = [
      { role: 'user', content: '用户问题 B' },
      { role: 'assistant', content: '回复' },
    ] as any;

    const key1 = computeHashKey('system', history1, []);
    const key2 = computeHashKey('system', history2, []);
    expect(key1).not.toBe(key2);
  });
});

// ============================
// Prompt 工具测试
// ============================
describe('Prompt 构造工具', () => {
  describe('contentToString', () => {
    it('字符串 content 直接返回', () => {
      expect(contentToString('hello world')).toBe('hello world');
    });

    it('ContentItem 数组中提取文本', () => {
      const content = [
        { type: 'text', text: '第一段' },
        { type: 'text', text: '第二段' },
      ];
      expect(contentToString(content)).toBe('第一段\n第二段');
    });

    it('非 text 类型应拼接除 type 外的全部字段（如 tool_result）', () => {
      const content = [
        {
          type: 'tool_result',
          tool_call_id: 'call_abc',
          content: 'a.md\nb.md',
          extra: { code: 0 },
        },
      ];
      const result = contentToString(content);
      expect(result).toContain('[tool_result]');
      expect(result).toContain('"tool_call_id":"call_abc"');
      expect(result).toContain('"content":"a.md\\nb.md"');
      expect(result).toContain('"extra":{"code":0}');
    });

    it('image_url 类型应该显示占位符', () => {
      const content = [
        { type: 'image_url', image_url: 'https://example.com/img.jpg' },
      ];
      expect(contentToString(content)).toContain('[image_url]');
      expect(contentToString(content)).toContain('"image_url":"https://example.com/img.jpg"');
    });
  });

  describe('buildSystemPrompt', () => {
    it('应该包含 system 标记和内容', () => {
      const result = buildSystemPrompt('You are a helpful assistant.');
      expect(result).toBe('<|system|>\nYou are a helpful assistant.');
    });

    it('空 system 应该返回空字符串', () => {
      expect(buildSystemPrompt('')).toBe('');
    });
  });

  describe('buildHistoryPrompt', () => {
    it('应该为每条消息添加 role 标记', () => {
      const history = [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好，有什么可以帮你？' },
      ];
      const result = buildHistoryPrompt(history);
      expect(result).toContain('<|role:user|>');
      expect(result).toContain('<|role:assistant|>');
      expect(result).toContain('你好');
      expect(result).toContain('你好，有什么可以帮你？');
    });

    it('assistant 含 tool_calls 时应写入 tool_calls 块', () => {
      const history = [
        {
          role: 'assistant',
          content: [{ type: 'text', text: '我来调用工具' }],
          tool_calls: [
            {
              id: 'call_xyz',
              type: 'function' as const,
              function: { name: 'read_file', arguments: '{"path":"a.md"}' },
            },
          ],
        },
      ];
      const result = buildHistoryPrompt(history as any);
      expect(result).toContain('<|tool_calls|>');
      expect(result).toContain('"id":"call_xyz"');
      expect(result).toContain('"name":"read_file"');
    });

    it('空 history 应该返回空字符串', () => {
      expect(buildHistoryPrompt([])).toBe('');
    });
  });

  describe('buildCurrentPrompt', () => {
    it('应该只返回 content 内容，不含 role 标记', () => {
      const current = { role: 'user', content: '当前问题' };
      const result = buildCurrentPrompt(current);
      expect(result).toBe('当前问题');
      expect(result).not.toContain('user');
      expect(result).not.toContain('<|');
    });

    it('current 含 tool_calls 时应该拼接 tool_calls 信息', () => {
      const current = {
        role: 'assistant',
        content: [{ type: 'text', text: '准备调用工具' }],
        tool_calls: [
          {
            id: 'call_1',
            type: 'function' as const,
            function: { name: 'exec', arguments: '{"command":"ls"}' },
          },
        ],
      };
      const result = buildCurrentPrompt(current);
      expect(result).toContain('准备调用工具');
      expect(result).toContain('<|tool_calls|>');
      expect(result).toContain('"id":"call_1"');
      expect(result).toContain('"name":"exec"');
    });
  });

  describe('buildCurrentPromptForWebSend', () => {
    it('template 为空时应直接返回原消息', () => {
      const result = buildCurrentPromptForWebSend({
        template: '   ',
        currentPrompt: '原始消息',
      });
      expect(result).toBe('原始消息');
    });

    it('template 存在 {{content}} 时应替换为当前消息', () => {
      const result = buildCurrentPromptForWebSend({
        template: '注意：仅做输出\n{{content}}',
        currentPrompt: '请帮我总结今天的会议',
      });
      expect(result).toBe('注意：仅做输出\n请帮我总结今天的会议');
    });

    it('template 中多处 {{content}} 应全部替换', () => {
      const result = buildCurrentPromptForWebSend({
        template: 'A={{content}}\nB={{content}}',
        currentPrompt: 'X',
      });
      expect(result).toBe('A=X\nB=X');
    });
  });

  describe('buildToolsPrompt', () => {
    it('应该正确构造工具列表', () => {
      const tools = [
        {
          type: 'function' as const,
          function: {
            name: 'read_file',
            description: 'Read a file',
            parameters: {
              type: 'object',
              required: ['path'],
              properties: {
                path: { type: 'string', description: 'file path' },
                offset: { type: 'number', description: 'line offset' },
              },
            },
          },
        },
      ];
      const result = buildToolsPrompt(tools);
      expect(result).toContain('Tool 1');
      expect(result).toContain('Name: read_file');
      expect(result).toContain('Description: Read a file');
      expect(result).toContain('path(string, required)');
      expect(result).toContain('offset(number)');
    });

    it('空 tools 应该返回空字符串', () => {
      expect(buildToolsPrompt([])).toBe('');
    });
  });
});

// ============================
// DataManager 类测试
// ============================
describe('DataManager', () => {
  describe('构造函数', () => {
    it('应该正确初始化属性', () => {
      const dm = createTestDataManager();
      expect(dm.model).toBe('gpt-4o');
      expect(dm.system).toBe('You are a helpful assistant.');
      expect(dm.history).toHaveLength(2);
      expect(dm.tools).toHaveLength(1);
      expect(dm.current.role).toBe('user');
    });

    it('应该在初始化时计算 HASH_KEY', () => {
      const dm = createTestDataManager();
      expect(dm.HASH_KEY).toBeTruthy();
      expect(dm.HASH_KEY).toMatch(/^[a-f0-9]+_[a-f0-9]+_[a-f0-9]+$/);
    });

    it('应该在初始化时设置 DATA_PATH', () => {
      const dm = createTestDataManager();
      expect(dm.DATA_PATH).toBeTruthy();
      expect(dm.DATA_PATH).toContain('gpt-4o');
    });
  });

  describe('is_linked()', () => {
    it('未保存数据时应该返回 false', () => {
      const dm = createTestDataManager();
      expect(dm.is_linked()).toBe(false);
    });

    it('保存数据后、未更新 web_url 时应该返回 false', async () => {
      const dm = createTestDataManager();
      await dm.save_data();
      expect(dm.is_linked()).toBe(false);
    });

    it('更新 web_url 后应该返回 true', async () => {
      const dm = createTestDataManager();
      await dm.save_data();
      dm.update_web_url('https://chat.deepseek.com/a/chat/s/test');
      expect(dm.is_linked()).toBe(true);
    });

    it('cancel_linked 后应该返回 false', async () => {
      const dm = createTestDataManager();
      await dm.save_data();
      dm.update_web_url('https://chat.deepseek.com/a/chat/s/test');
      dm.cancel_linked();
      expect(dm.is_linked()).toBe(false);
    });
  });

  describe('save_data()', () => {
    it('应该创建数据目录', async () => {
      const dm = createTestDataManager();
      await dm.save_data();
      expect(fs.existsSync(dm.DATA_PATH)).toBe(true);
    });

    it('应该创建 system 文件', async () => {
      const dm = createTestDataManager();
      await dm.save_data();
      const systemFile = path.join(dm.DATA_PATH, 'system');
      expect(fs.existsSync(systemFile)).toBe(true);
      expect(fs.readFileSync(systemFile, 'utf-8')).toBe('You are a helpful assistant.');
    });

    it('应该创建 history.jsonl 文件', async () => {
      const dm = createTestDataManager();
      await dm.save_data();
      const historyFile = path.join(dm.DATA_PATH, 'history.jsonl');
      expect(fs.existsSync(historyFile)).toBe(true);
    });

    it('history.jsonl 应该包含 history + current 的所有消息', async () => {
      const dm = createTestDataManager();
      await dm.save_data();
      const historyFile = path.join(dm.DATA_PATH, 'history.jsonl');
      const content = fs.readFileSync(historyFile, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      // history 有 2 条，current 有 1 条
      expect(lines).toHaveLength(3);
    });

    it('应该创建 tools.json 文件', async () => {
      const dm = createTestDataManager();
      await dm.save_data();
      const toolsFile = path.join(dm.DATA_PATH, 'tools.json');
      expect(fs.existsSync(toolsFile)).toBe(true);
      const tools = JSON.parse(fs.readFileSync(toolsFile, 'utf-8'));
      expect(tools).toHaveLength(1);
    });

    it('首次 save_data 后也应将 current 合并进内存 history（修复点 A）', async () => {
      const dm = createTestDataManager();
      const oldHash = dm.HASH_KEY;
      await dm.save_data();
      expect(dm.history).toHaveLength(3);
      expect(dm.history[2].content).toBe('当前消息');
      expect(dm.HASH_KEY).not.toBe(oldHash);
    });
  });

  describe('get_web_url() & update_web_url()', () => {
    it('没有 web_url 文件时应该返回空字符串', async () => {
      const dm = createTestDataManager();
      await dm.save_data();
      expect(dm.get_web_url()).toBe('');
    });

    it('前缀 hash 不应复用旧会话：旧会话推进后，新的同首句请求应创建新会话', async () => {
      const req1: InternalRequest = {
        model: 'gpt-4o',
        system: 'You are a helpful assistant.',
        history: [],
        tools: [],
        current: { role: 'user', content: 'user_content1' },
      };

      const dm1 = createTestDataManager(req1);
      await dm1.save_data();
      dm1.update_web_url('https://chat.deepseek.com/a/chat/s/old-session');
      const firstSessionPath = dm1.DATA_PATH;

      // 推进到新 hash（u1 -> u1,u2）
      dm1.update_current({ role: 'assistant', content: 'assistant_reply1' });
      await dm1.save_data();
      dm1.update_current({ role: 'user', content: 'user_content2' });
      await dm1.save_data();

      const req2: InternalRequest = {
        model: 'gpt-4o',
        system: 'You are a helpful assistant.',
        history: [],
        tools: [],
        current: { role: 'user', content: 'user_content1' },
      };

      const dm2 = createTestDataManager(req2);
      await dm2.save_data();

      expect(dm2.get_web_url()).toBe('');
      expect(dm2.is_linked()).toBe(false);
      expect(dm2.DATA_PATH).not.toBe(firstSessionPath);
    });

    it('update_web_url 后应该能通过 get_web_url 获取到', async () => {
      const dm = createTestDataManager();
      await dm.save_data();
      const testUrl = 'https://chat.deepseek.com/a/chat/s/abc123';
      dm.update_web_url(testUrl);
      expect(dm.get_web_url()).toBe(testUrl);
    });

    it('多次 update_web_url 应该返回最后一条', async () => {
      const dm = createTestDataManager();
      await dm.save_data();
      dm.update_web_url('https://example.com/1');
      dm.update_web_url('https://example.com/2');
      dm.update_web_url('https://example.com/3');
      expect(dm.get_web_url()).toBe('https://example.com/3');
    });

    it('仅 assistant 推进时 hash 不变，但应继承旧 hash 的 web_url 列表（索引映射）', async () => {
      const dm = createTestDataManager();
      await dm.save_data();
      dm.update_web_url('https://example.com/session-1');
      const oldHash = dm.HASH_KEY;

      dm.update_current({ role: 'assistant', content: '下一轮回复' });
      await dm.save_data();

      expect(dm.HASH_KEY).toBe(oldHash);
      expect(dm.get_web_url()).toBe('https://example.com/session-1');

      dm.update_web_url('https://example.com/session-2');
      expect(dm.get_web_url()).toBe('https://example.com/session-2');
    });
  });

  describe('update_current()', () => {
    it('应该更新 current 属性', () => {
      const dm = createTestDataManager();
      const newCurrent = { role: 'user', content: '新的当前消息' };
      dm.update_current(newCurrent);
      expect(dm.current).toEqual(newCurrent);
    });
  });

  describe('Prompt 方法', () => {
    it('get_system_prompt 应该包含 system 标记', () => {
      const dm = createTestDataManager();
      const prompt = dm.get_system_prompt();
      expect(prompt).toContain('<|system|>');
      expect(prompt).toContain('You are a helpful assistant.');
    });

    it('get_history_prompt 应该包含 role 标记', () => {
      const dm = createTestDataManager();
      const prompt = dm.get_history_prompt();
      expect(prompt).toContain('<|role:user|>');
      expect(prompt).toContain('<|role:assistant|>');
    });

    it('get_current_prompt 应该返回当前消息内容', () => {
      const dm = createTestDataManager();
      const prompt = dm.get_current_prompt();
      expect(prompt).toBe('当前消息');
    });

    it('get_tools_prompt 应该包含工具信息', () => {
      const dm = createTestDataManager();
      const prompt = dm.get_tools_prompt();
      expect(prompt).toContain('Tool 1');
      expect(prompt).toContain('read_file');
    });

    it('get_init_prompt 应该包含所有部分', () => {
      const dm = createTestDataManager();
      const prompt = dm.get_init_prompt();
      expect(prompt).toContain('{"test": "template"}');
      // 模板已替换，验证实际内容已填入
      expect(prompt).toContain('<|system|>');  // system_prompt 已替换为实际内容
      expect(prompt).toBeTruthy();
    });

    it('get_current_prompt_with_template 应该包含模板和当前内容', () => {
      const dm = createTestDataManager();
      const prompt = dm.get_current_prompt_with_template();
      expect(prompt).toContain('{"test": "template"}');
      expect(prompt).toContain('当前消息');
    });

    it('get_current_prompt_for_web_send 在模板非空时应进行包装替换', () => {
      const dm = new DataManager(mockRequest, {
        rootDir: tmpDir,
        models: {
          GPT: ['gpt-4', 'gpt-4o', 'gpt-4-turbo', 'gpt-5', 'gpt-5.1', 'gpt-5.2'],
          DEEPSEEK: ['deepseek-chat', 'deepseek-r1'],
        },
        jsonTemplate: '{"test": "template"}',
        initPromptTemplate:
          '此次对话的所有回答都必须严格按照下面的json模板进行回复，不能有任何例外:\n{{json_template}}\n\n下面是此次对话的系统提示词，你只需要按约定的回复格式回复"收到"即可.\n{{system_prompt}}\n\n下面是你可以访问的工具：\n{{tools_prompt}}\n\n下面是之前的一些历史对话，仅供参考:\n{{history_prompt}}',
        currentTemplate: '请按照下面的模板回答\n{{json_template}}\n\n---\n{{current}}',
        userMessageTemplate: '注意：仅做输出，不执行任何操作！！\n{{content}}',
      });

      const prompt = dm.get_current_prompt_for_web_send();
      expect(prompt).toContain('注意：仅做输出，不执行任何操作！！');
      expect(prompt).toContain('当前消息');
    });

    it('get_current_prompt_for_web_send 在模板为空时应返回原消息', () => {
      const dm = createTestDataManager();
      const prompt = dm.get_current_prompt_for_web_send();
      expect(prompt).toBe('当前消息');
    });
  });

  describe('get_usage()', () => {
    it('应该返回 usage 三段结构，并满足 total = prompt + completion', () => {
      const dm = createTestDataManager();
      const result = dm.get_usage();

      expect(result).toHaveProperty('usage');
      expect(result.usage).toHaveProperty('prompt_tokens');
      expect(result.usage).toHaveProperty('completion_tokens');
      expect(result.usage).toHaveProperty('total_tokens');

      expect(typeof result.usage.prompt_tokens).toBe('number');
      expect(typeof result.usage.completion_tokens).toBe('number');
      expect(typeof result.usage.total_tokens).toBe('number');

      expect(result.usage.prompt_tokens).toBeGreaterThan(0);
      expect(result.usage.completion_tokens).toBeGreaterThan(0);
      expect(result.usage.total_tokens).toBe(
        result.usage.prompt_tokens + result.usage.completion_tokens
      );
    });

    it('当 current 内容更长时，completion_tokens 应该不小于原值', () => {
      const dmShort = createTestDataManager({
        ...mockRequest,
        current: { role: 'assistant', content: '短回复' },
      });
      const shortUsage = dmShort.get_usage();

      const dmLong = createTestDataManager({
        ...mockRequest,
        current: {
          role: 'assistant',
          content:
            '这是一个更长的回复，用于测试 completion token 估算是否会随文本长度增加而变大。包含 English words and symbols 12345。',
        },
      });
      const longUsage = dmLong.get_usage();

      expect(longUsage.usage.completion_tokens).toBeGreaterThanOrEqual(
        shortUsage.usage.completion_tokens
      );
    });
  });

  describe('模型分类', () => {
    it('GPT 模型应该存储在 gpt 目录下', () => {
      const dm = createTestDataManager({ ...mockRequest, model: 'gpt-4o' });
      expect(dm.DATA_PATH).toContain('gpt');
    });

    it('DeepSeek 模型应该存储在 deepseek 目录下', () => {
      const dm = createTestDataManager({ ...mockRequest, model: 'deepseek-chat' });
      expect(dm.DATA_PATH).toContain('deepseek');
    });

    it('未知模型应该使用 model 名称作为目录', () => {
      const dm = createTestDataManager({ ...mockRequest, model: 'unknown-model' });
      expect(dm.DATA_PATH).toContain('unknown');
    });
  });
});
