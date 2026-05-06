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
            description: 'Maximum execution time in milliseconds (default: 30000)',
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

    const timeoutMs = typeof args.timeout === 'number' && args.timeout > 0 ? args.timeout : 30000;

    try {
      const result = child_process.execSync(command, {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024, // 1MB
        encoding: 'utf-8',
        shell: '/bin/sh',
      });
      // 截断过长输出
      const maxLen = 10000;
      const stdout = result.length > maxLen ? result.slice(0, maxLen) + '\n... (truncated)' : result;
      return JSON.stringify({ stdout, stderr: '', exit_code: 0 });
    } catch (err: any) {
      const stdout = typeof err.stdout === 'string' ? err.stdout : '';
      const stderr = typeof err.stderr === 'string' ? err.stderr : err.message ?? '';
      const exitCode = typeof err.status === 'number' ? err.status : 1;
      return JSON.stringify({ stdout, stderr, exit_code: exitCode });
    }
  },
};