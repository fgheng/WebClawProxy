import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../../types';
import { ToolModule } from './tool-module';
import { expandPath } from './expand-path';

export const writeFileModule: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does. Automatically creates parent directories if needed.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path of the file to write',
          },
          content: {
            type: 'string',
            description: 'The content to write to the file',
          },
        },
        required: ['path', 'content'],
      },
    },
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    let filePath = String(args.path ?? '');
    const content = String(args.content ?? '');
    filePath = expandPath(filePath);
    if (!filePath.trim()) return JSON.stringify({ error: 'Empty path' });

    try {
      // 创建父目录
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(filePath, content, 'utf-8');
      return `Successfully wrote ${content.length} bytes to ${filePath}`;
    } catch (err: any) {
      return JSON.stringify({ error: err.message ?? String(err) });
    }
  },
};