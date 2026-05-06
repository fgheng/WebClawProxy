import * as os from 'os';
import * as path from 'path';

/**
 * 展开 Shell 风格路径:
 *   ~ → $HOME (os.homedir())
 *   $HOME / ${HOME} → os.homedir()
 *   环境变量 $VAR / ${VAR} → process.env[VAR] 或原值
 */
export function expandPath(p: string): string {
  if (!p) return p;

  // ~ 或 ~/...
  if (p.startsWith('~')) {
    return os.homedir() + p.slice(1);
  }

  // $HOME / ${HOME}
  let result = p;
  result = result.replace(/\$HOME/g, os.homedir());
  result = result.replace(/\${HOME}/g, os.homedir());

  // 通用 $VAR / ${VAR}
  result = result.replace(/\${(\w+)}/g, (_, varName) => {
    return process.env[varName] ?? _;
  });
  result = result.replace(/\$(\w+)/g, (_, varName) => {
    // 只替换紧跟 / 或结尾的环境变量，避免误替换
    return process.env[varName] ?? _;
  });

  // 如果不是绝对路径，相对于 cwd 展开
  if (!path.isAbsolute(result)) {
    result = path.resolve(process.cwd(), result);
  }

  return result;
}