import * as http from 'http';
import * as https from 'https';
import { Tool } from '../../types';
import { ToolModule } from './tool-module';

export const browserModule: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'browser',
      description: 'Control a Chromium browser through WebClawProxy server. Actions: navigate (open URL), click (click an element), type (enter text), screenshot (capture current page), extract (get page text content). Requires WebClawProxy server to be running.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['navigate', 'click', 'type', 'screenshot', 'extract'],
            description: 'The browser action to perform',
          },
          url: {
            type: 'string',
            description: 'URL to navigate to (for navigate action)',
          },
          selector: {
            type: 'string',
            description: 'CSS selector of the element (for click and type actions)',
          },
          text: {
            type: 'string',
            description: 'Text to type into the element (for type action)',
          },
        },
        required: ['action'],
      },
    },
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const action = String(args.action ?? '');
    if (!action.trim()) return JSON.stringify({ error: 'Empty action' });

    // 获取服务端 baseUrl（从 Transport config）
    // browser 工具需要知道 WebClawProxy 服务端地址
    // 暂时使用环境变量或硬编码默认值
    const baseUrl = process.env.WEBCLAW_PROXY_URL ?? 'http://localhost:3000';

    try {
      switch (action) {
        case 'navigate':
          return await browserNavigate(baseUrl, String(args.url ?? ''));
        case 'click':
          return await browserClick(baseUrl, String(args.selector ?? ''));
        case 'type':
          return await browserType(baseUrl, String(args.selector ?? ''), String(args.text ?? ''));
        case 'screenshot':
          return await browserScreenshot(baseUrl);
        case 'extract':
          return await browserExtract(baseUrl);
        default:
          return JSON.stringify({ error: `Unknown action: ${action}` });
      }
    } catch (err: any) {
      return JSON.stringify({ error: err.message ?? String(err) });
    }
  },
};

async function browserNavigate(baseUrl: string, url: string): Promise<string> {
  if (!url.trim()) return JSON.stringify({ error: 'URL is required for navigate action' });
  const result = await httpPost(`${baseUrl}/v1/browser/navigate`, { url });
  return `Navigated to ${url}. ${result}`;
}

async function browserClick(baseUrl: string, selector: string): Promise<string> {
  if (!selector.trim()) return JSON.stringify({ error: 'Selector is required for click action' });
  const result = await httpPost(`${baseUrl}/v1/browser/click`, { selector });
  return `Clicked element "${selector}". ${result}`;
}

async function browserType(baseUrl: string, selector: string, text: string): Promise<string> {
  if (!selector.trim()) return JSON.stringify({ error: 'Selector is required for type action' });
  const result = await httpPost(`${baseUrl}/v1/browser/type`, { selector, text });
  return `Typed "${text}" into "${selector}". ${result}`;
}

async function browserScreenshot(baseUrl: string): Promise<string> {
  const result = await httpGet(`${baseUrl}/v1/browser/screenshot`);
  return `Screenshot taken. ${typeof result === 'string' ? result.slice(0, 500) : JSON.stringify(result).slice(0, 500)}`;
}

async function browserExtract(baseUrl: string): Promise<string> {
  const result = await httpGet(`${baseUrl}/v1/browser/extract`);
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  if (text.length > 10000) return text.slice(0, 10000) + '\n... (truncated)';
  return text;
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    transport.get(url, { timeout: 15000, headers: { 'User-Agent': 'WebClaw/1.0' } }, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => (data += chunk));
      res.on('end', () => resolve(data));
    }).on('error', reject).on('timeout', () => { reject(new Error('timeout')); });
  });
}

function httpPost(url: string, body: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const bodyStr = JSON.stringify(body);

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'User-Agent': 'WebClaw/1.0',
      },
    };

    const req = transport.request(options, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => (data += chunk));
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(bodyStr);
    req.end();
  });
}