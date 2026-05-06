import { Tool } from '../../types';
import { ToolExecutor } from '../types';
import { execModule } from './exec';
import { readFileModule } from './read-file';
import { writeFileModule } from './write-file';
import { listDirectoryModule } from './list-directory';
import { webFetchModule } from './web-fetch';
import { webSearchModule } from './web-search';
import { browserModule } from './browser';

/** 所有内置工具模块 */
const allModules = [
  execModule,
  readFileModule,
  writeFileModule,
  listDirectoryModule,
  webFetchModule,
  webSearchModule,
  browserModule,
];

/** 内置工具的 OpenAI function definitions（传给 body.tools） */
export const builtInToolDefinitions: Tool[] = allModules.map((m) => m.definition);

/** 内置工具执行器 */
export const builtInToolExecutor: ToolExecutor = {
  async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
    const module = allModules.find((m) => m.definition.function.name === toolName);
    if (!module) {
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
    return module.execute(args);
  },
};

/** 工具名列表 */
export const builtInToolNames: string[] = allModules.map((m) => m.definition.function.name);