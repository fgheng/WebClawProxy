import path from 'path';
import request from 'supertest';

const mockInitConversation = jest.fn();
const mockChat = jest.fn();
const mockSendOnly = jest.fn();
const mockOpenBrowser = jest.fn();
const mockClose = jest.fn();
const mockSaveData = jest.fn();

describe('chat.completions 转发模式', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockSaveData.mockResolvedValue(undefined);
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  function createForwardModeApp() {
    const configPathSuffix = path.join('config', 'default.json');
    const mockConfig = {
      providers: {
        glm: {
          default_mode: 'forward',
          models: ['glm-4.5'],
          forward: {
            base_url: 'https://upstream.example.com/v1',
            api_key: 'sk-forward-demo',
            timeout_ms: 30000,
          },
        },
      },
    };

    jest.doMock('fs', () => {
      const actualFs = jest.requireActual('fs');
      return {
        ...actualFs,
        readFileSync: jest.fn((filePath: string, ...args: unknown[]) => {
          if (typeof filePath === 'string' && filePath.endsWith(configPathSuffix)) {
            return JSON.stringify(mockConfig);
          }
          return actualFs.readFileSync(filePath, ...(args as [any]));
        }),
      };
    });

    jest.doMock('../../src/web-driver/WebDriverManager', () => {
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

    jest.doMock('../../src/data-manager/DataManager', () => {
      return {
        DataManager: jest.fn().mockImplementation(() => ({
          save_data: mockSaveData,
        })),
      };
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createApp } = require('../../src/controller/server');
    return createApp();
  }

  it('非流式请求应直接转发到上游 chat/completions', async () => {
    const app = createForwardModeApp();
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-forward',
          object: 'chat.completion',
          model: 'glm-4.5',
          choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }
      )
    );

    const reqBody = {
      model: 'glm-4.5',
      messages: [{ role: 'user', content: '你好' }],
      stream: false,
    };

    const res = await request(app)
      .post('/v1/chat/completions')
      .send(reqBody)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toMatchObject({
      object: 'chat.completion',
      model: 'glm-4.5',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://upstream.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer sk-forward-demo',
          'content-type': 'application/json',
        }),
        body: JSON.stringify(reqBody),
      })
    );
    expect(mockSaveData).not.toHaveBeenCalled();
    expect(mockInitConversation).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('流式请求应原样透传上游 SSE 响应', async () => {
    const app = createForwardModeApp();
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      new Response('data: {"id":"chunk-1"}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
        },
      })
    );

    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'glm-4.5',
        messages: [{ role: 'user', content: '你好' }],
        stream: true,
      })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('data: {"id":"chunk-1"}');
    expect(res.text).toContain('data: [DONE]');
    expect(mockInitConversation).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('provider 显式为 forward 但缺少凭据时应返回配置错误', async () => {
    const configPathSuffix = path.join('config', 'default.json');
    const mockConfig = {
      providers: {
        glm: {
          default_mode: 'forward',
          models: ['glm-4.5'],
          forward: {
            base_url: 'https://upstream.example.com/v1',
          },
        },
      },
    };

    jest.doMock('fs', () => {
      const actualFs = jest.requireActual('fs');
      return {
        ...actualFs,
        readFileSync: jest.fn((filePath: string, ...args: unknown[]) => {
          if (typeof filePath === 'string' && filePath.endsWith(configPathSuffix)) {
            return JSON.stringify(mockConfig);
          }
          return actualFs.readFileSync(filePath, ...(args as [any]));
        }),
      };
    });

    jest.doMock('../../src/web-driver/WebDriverManager', () => {
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

    jest.doMock('../../src/data-manager/DataManager', () => {
      return {
        DataManager: jest.fn().mockImplementation(() => ({
          save_data: mockSaveData,
        })),
      };
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createApp } = require('../../src/controller/server');
    const app = createApp();

    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'glm-4.5',
        messages: [{ role: 'user', content: '你好' }],
      })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('FORWARD_PROVIDER_MISCONFIGURED');
  });
});
