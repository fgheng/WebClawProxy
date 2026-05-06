import * as os from 'os';
import * as path from 'path';

/**
 * 展开 shell 风格路径：
 * - `~` → 用户 home 目录
 * - `$HOME` / `${HOME}` → 用户 home 目录
 * - `$PWD` / `${PWD}` → 当前工作目录
 * - 其他 `$VAR` / `${VAR}` → process.env 中对应值（未设置则保留原样）
 */
export function expandPath(inputPath: string): string {
  if (!inputPath) return inputPath;

  // 先展开 ${VAR} 形式
  let result = inputPath.replace(/\$\{(\w+)\}/g, (_, varName) => {
    if (varName === 'HOME') return os.homedir();
    if (varName === 'PWD') return process.cwd();
    const envVal = process.env[varName];
    return envVal ?? `\${${varName}}`;
  });

  // 再展开 $VAR 形式（不含花括号）
  result = result.replace(/\$(\w+)/g, (_, varName) => {
    if (varName === 'HOME') return os.homedir();
    if (varName === 'PWD') return process.cwd();
    const envVal = process.env[varName];
    return envVal ?? `$${varName}`;
  });

  // 最后展开 ~ 开头
  if (result.startsWith('~')) {
    result = os.homedir() + result.slice(1);
  }

  // 如果不是绝对路径，相对于 cwd 解析
  if (!path.isAbsolute(result)) {
    result = path.resolve(process.cwd(), result);
  }

  return result;
}