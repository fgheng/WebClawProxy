import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../../types';
import { ToolModule } from './tool-module';
import { expandPath } from './expand-path';

export const listDirectoryModule: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and directories at the given path. Returns names, types (file/directory), and sizes. Optionally list recursively.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The directory path to list',
          },
          recursive: {
            type: 'boolean',
            description: 'Whether to list subdirectories recursively (default: false)',
          },
        },
        required: ['path'],
      },
    },
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    let dirPath = String(args.path ?? '');
    if (!dirPath.trim()) return JSON.stringify({ error: 'Empty path' });
    dirPath = expandPath(dirPath);

    const recursive = args.recursive === true;
    const maxItems = 500;

    try {
      if (!fs.existsSync(dirPath)) {
        return JSON.stringify({ error: `Directory not found: ${dirPath}` });
      }

      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) {
        return JSON.stringify({ error: `Not a directory: ${dirPath}` });
      }

      const items: Array<{ name: string; type: string; size?: number }> = [];

      function walk(dir: string, depth: number): void {
        if (depth > 5 || items.length >= maxItems) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (items.length >= maxItems) break;
          const fullPath = path.join(dir, entry.name);
          try {
            const s = fs.statSync(fullPath);
            items.push({
              name: recursive ? fullPath : entry.name,
              type: s.isDirectory() ? 'directory' : 'file',
              size: s.isDirectory() ? undefined : s.size,
            });
            if (recursive && s.isDirectory() && entry.name !== '.git' && entry.name !== 'node_modules') {
              walk(fullPath, depth + 1);
            }
          } catch {
            items.push({ name: entry.name, type: 'unknown' });
          }
        }
      }

      walk(dirPath, 0);

      const result = items.map((i) =>
        i.type === 'file' ? `${i.name} (${i.type}, ${i.size ?? 0} bytes)` : `${i.name} (${i.type})`
      ).join('\n');

      return result || '(empty directory)';
    } catch (err: any) {
      return JSON.stringify({ error: err.message ?? String(err) });
    }
  },
};