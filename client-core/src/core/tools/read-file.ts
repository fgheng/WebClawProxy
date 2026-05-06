import * as fs from 'fs';
import { Tool } from '../../types';
import { ToolModule } from './tool-module';
import { expandPath } from './expand-path';

export const readFileModule: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file at the given path. Optionally specify offset (line number to start from, 1-based) and limit (number of lines to read) for large files.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path of the file to read',
          },
          offset: {
            type: 'number',
            description: 'Line number to start reading from (1-based, default: 1)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of lines to read (default: 2000)',
          },
        },
        required: ['path'],
      },
    },
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = expandPath(String(args.path ?? ''));
    if (!filePath.trim()) return JSON.stringify({ error: 'Empty path' });

    const offset = typeof args.offset === 'number' && args.offset > 0 ? args.offset : 1;
    const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 2000;

    try {
      if (!fs.existsSync(filePath)) {
        return JSON.stringify({ error: `File not found: ${filePath}` });
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const selectedLines = lines.slice(offset - 1, offset - 1 + limit);
      const result = selectedLines.join('\n');

      // 截断过长输出
      const maxLen = 10000;
      if (result.length > maxLen) {
        return result.slice(0, maxLen) + '\n... (truncated, file has ' + lines.length + ' lines total)';
      }
      return result || '(empty file)';
    } catch (err: any) {
      return JSON.stringify({ error: err.message ?? String(err) });
    }
  },
};