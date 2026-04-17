export type ParsedCommand =
  | { type: 'help' | 'clear' | 'reset' | 'history' | 'config' | 'trace' | 'new' | 'sessions' | 'quit' | 'exit' }
  | { type: 'model' | 'system'; value: string }
  | { type: 'provider'; value: string }
  | { type: 'mode'; value: 'web' | 'forward' }
  | { type: 'session'; value: string }
  | { type: 'stream'; enabled?: boolean };

export function parseCommand(input: string): ParsedCommand | null {
  const [rawCommand, ...rest] = input.trim().split(/\s+/);
  const command = rawCommand.toLowerCase();
  const value = rest.join(' ').trim();

  switch (command) {
    case '/help':
      return { type: 'help' };
    case '/clear':
      return { type: 'clear' };
    case '/reset':
      return { type: 'reset' };
    case '/history':
      return { type: 'history' };
    case '/config':
      return { type: 'config' };
    case '/trace':
      return { type: 'trace' };
    case '/new':
      return { type: 'new' };
    case '/sessions':
      return { type: 'sessions' };
    case '/quit':
      return { type: 'quit' };
    case '/exit':
      return { type: 'exit' };
    case '/model':
      return value ? { type: 'model', value } : null;
    case '/provider':
      return value ? { type: 'provider', value } : null;
    case '/mode': {
      if (!value) return null;
      const normalized = value.toLowerCase();
      if (normalized === 'web' || normalized === 'forward') {
        return { type: 'mode', value: normalized };
      }
      return null;
    }
    case '/session':
      return value ? { type: 'session', value } : null;
    case '/system':
      return value ? { type: 'system', value } : null;
    case '/stream': {
      if (!value) return { type: 'stream' };
      const normalized = value.toLowerCase();
      if (['on', 'true', '1'].includes(normalized)) return { type: 'stream', enabled: true };
      if (['off', 'false', '0'].includes(normalized)) return { type: 'stream', enabled: false };
      return null;
    }
    default:
      return null;
  }
}
