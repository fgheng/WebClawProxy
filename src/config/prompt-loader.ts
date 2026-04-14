import * as fs from 'fs';
import * as path from 'path';

const PROMPT_REF_RE = /\[\[([^[\]\r\n]+)\]\]/g;

type ResolveContext = {
  promptsRoot: string;
  stack: string[];
};

export function resolvePromptRefsInValue<T>(value: T, promptsRoot: string): T {
  return resolveDeep(value, {
    promptsRoot,
    stack: [],
  });
}

function resolveDeep<T>(value: T, context: ResolveContext): T {
  if (typeof value === 'string') {
    return resolvePromptRefsInString(value, context) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveDeep(item, context)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [key, resolveDeep(val, context)])
    ) as T;
  }

  return value;
}

function resolvePromptRefsInString(input: string, context: ResolveContext): string {
  return input.replace(PROMPT_REF_RE, (_whole, rawRef: string) => {
    const ref = rawRef.trim();
    if (!ref) return '';

    const absolute = path.resolve(context.promptsRoot, ref);
    if (!isPathInsideRoot(absolute, context.promptsRoot)) {
      throw new Error(`提示词引用越界: [[${ref}]]，仅允许引用 prompts 目录内文件`);
    }
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      throw new Error(`提示词文件不存在: [[${ref}]] -> ${absolute}`);
    }
    if (context.stack.includes(absolute)) {
      const chain = [...context.stack, absolute].map((item) => path.relative(context.promptsRoot, item)).join(' -> ');
      throw new Error(`提示词引用存在循环: ${chain}`);
    }

    const content = fs.readFileSync(absolute, 'utf-8');
    return resolvePromptRefsInString(content, {
      promptsRoot: context.promptsRoot,
      stack: [...context.stack, absolute],
    });
  });
}

function isPathInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
