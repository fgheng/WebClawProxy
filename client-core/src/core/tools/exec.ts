import * as child_process from 'child_process';
import { Tool } from '../../types';
import { ToolModule } from './tool-module';

const BLOCKED_COMMANDS = [
  'rm -rf /', 'rm -rf /*', 'mkfs', 'dd if=', ':(){ :|:& };:',
  'sudo rm', 'shutdown', 'reboot', 'halt', 'poweroff',
  'format', 'del /s /q C:', 'rmdir /s /q C:',
];

function isBlocked(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return BLOCKED_COMMANDS.some((blocked) => normalized.includes(blocked));
}

export const execModule: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'exec',
      description: 'Execute a shell command and return its stdout, stderr, and exit code. Use for running scripts, installing packages, git operations, and other system commands.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute',
          },
          timeout: {
            type: 'number',
            description: 'Maximum execution time in milliseconds (default: 300000)',
          },
        },
        required: ['command'],
      },
    },
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const command = String(args.command ?? '');
    if (!command.trim()) return JSON.stringify({ error: 'Empty command' });
    if (isBlocked(command)) return JSON.stringify({ error: 'Command blocked for safety' });

    const timeoutMs = typeof args.timeout === 'number' && args.timeout > 0 ? args.timeout : 300000;

    return new Promise<string>((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      const proc = child_process.spawn(command, [], {
        shell: '/bin/sh',
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
        // 如果输出过大，提前截断并杀进程
        if (stdout.length > 1_000_000 && !settled) {
          settled = true;
          proc.kill('SIGTERM');
          const maxLen = 10000;
          const truncated = stdout.slice(0, maxLen) + '\n... (truncated, output too large)';
          resolve(JSON.stringify({ stdout: truncated, stderr: stderr.slice(0, 10000), exit_code: 1 }));
        }
      });

      proc.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill('SIGTERM');
          // SIGTERM 后给 5 秒让进程退出，否则 SIGKILL
          setTimeout(() => {
            if (!proc.killed) proc.kill('SIGKILL');
          }, 5000);
          const maxLen = 10000;
          resolve(JSON.stringify({
            stdout: stdout.length > maxLen ? stdout.slice(0, maxLen) + '\n... (truncated)' : stdout,
            stderr: stderr.slice(0, maxLen) + `\n... timeout after ${timeoutMs}ms`,
            exit_code: 124,
          }));
        }
      }, timeoutMs);

      proc.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (settled) return; // 已经 resolve（超时或输出过大）
        settled = true;
        const maxLen = 10000;
        resolve(JSON.stringify({
          stdout: stdout.length > maxLen ? stdout.slice(0, maxLen) + '\n... (truncated)' : stdout,
          stderr: stderr.length > maxLen ? stderr.slice(0, maxLen) + '\n... (truncated)' : stderr,
          exit_code: code ?? 1,
        }));
      });

      proc.on('error', (err: Error) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve(JSON.stringify({ stdout: '', stderr: err.message, exit_code: 1 }));
      });
    });
  },
};