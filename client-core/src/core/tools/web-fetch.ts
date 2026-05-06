import * as http from 'http';
import * as https from 'https';
import { Tool } from '../../types';
import { ToolModule } from './tool-module';

export const webFetchModule: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch the content of a web page at the given URL. Returns the page text content, truncated if too long. Useful for reading documentation, APIs, or any web content.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch',
          },
          max_length: {
            type: 'number',
            description: 'Maximum length of returned content in characters (default: 10000)',
          },
        },
        required: ['url'],
      },
    },
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const url = String(args.url ?? '');
    if (!url.trim()) return JSON.stringify({ error: 'Empty URL' });

    const maxLength = typeof args.max_length === 'number' && args.max_length > 0 ? args.max_length : 10000;

    return new Promise<string>((resolve) => {
      try {
        const parsed = new URL(url);
        const transport = parsed.protocol === 'https:' ? https : http;

        const options = {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: 'GET',
          timeout: 15000,
          headers: {
            'User-Agent': 'WebClaw/1.0',
            'Accept': 'text/html,text/plain,application/json',
          },
        };

        const req = transport.request(options, (res: any) => {
          let data = '';
          res.on('data', (chunk: any) => (data += chunk));
          res.on('end', () => {
            // 提取纯文本（简单去除 HTML 标签）
            let text = data;
            if (String(res.headers['content-type'] ?? '').includes('html')) {
              text = stripHtmlTags(data);
            }
            // 截断
            if (text.length > maxLength) {
              resolve(text.slice(0, maxLength) + '\n... (truncated)');
            } else {
              resolve(text || '(empty response)');
            }
          });
        });

        req.on('error', (err: any) => {
          resolve(JSON.stringify({ error: err.message }));
        });

        req.on('timeout', () => {
          req.destroy();
          resolve(JSON.stringify({ error: 'Request timeout (15s)' }));
        });

        req.end();
      } catch (err: any) {
        resolve(JSON.stringify({ error: err.message ?? String(err) }));
      }
    });
  },
};

/** 简单的 HTML 标签去除 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/\s{3,}/g, '\n\n')
    .trim();
}