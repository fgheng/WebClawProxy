import * as http from 'http';
import * as https from 'https';
import { Tool } from '../../types';
import { ToolModule } from './tool-module';

export const webSearchModule: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web using a search engine. Returns a list of results with titles, URLs, and brief descriptions. Useful for finding information, documentation, or answers to questions.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query',
          },
          count: {
            type: 'number',
            description: 'Maximum number of results to return (default: 5)',
          },
        },
        required: ['query'],
      },
    },
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query ?? '');
    if (!query.trim()) return JSON.stringify({ error: 'Empty query' });

    const count = typeof args.count === 'number' && args.count > 0 ? Math.min(args.count, 10) : 5;

    // 使用 DuckDuckGo HTML 版搜索
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    return new Promise<string>((resolve) => {
      try {
        const parsed = new URL(url);
        const transport = parsed.protocol === 'https:' ? https : http;

        const options = {
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: parsed.pathname + parsed.search,
          method: 'GET',
          timeout: 15000,
          headers: {
            'User-Agent': 'WebClaw/1.0',
          },
        };

        const req = transport.request(options, (res: any) => {
          let data = '';
          res.on('data', (chunk: any) => (data += chunk));
          res.on('end', () => {
            const results = parseDuckDuckGoHtml(data, count);
            if (results.length === 0) {
              resolve('No search results found');
            } else {
              resolve(results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n'));
            }
          });
        });

        req.on('error', (err: any) => {
          resolve(JSON.stringify({ error: err.message }));
        });

        req.on('timeout', () => {
          req.destroy();
          resolve(JSON.stringify({ error: 'Search timeout (15s)' }));
        });

        req.end();
      } catch (err: any) {
        resolve(JSON.stringify({ error: err.message ?? String(err) }));
      }
    });
  },
};

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** 从 DuckDuckGo HTML 结果中解析搜索结果 */
function parseDuckDuckGoHtml(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = [];
  // DuckDuckGo HTML 结果在 <div class="result__"> 里
  const resultRegex = /class="result__"[^>]*>[\s\S]*?<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = resultRegex.exec(html)) !== null && results.length < max) {
    const url = decodeURIComponent(match[1] ?? '');
    const title = stripTags(match[2] ?? '').trim();
    const snippet = stripTags(match[3] ?? '').trim();
    results.push({ title, url, snippet });
  }

  return results;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}