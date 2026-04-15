"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCommand = parseCommand;
function parseCommand(input) {
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
        case '/quit':
            return { type: 'quit' };
        case '/exit':
            return { type: 'exit' };
        case '/model':
            return value ? { type: 'model', value } : null;
        case '/provider':
            return value ? { type: 'provider', value } : null;
        case '/system':
            return value ? { type: 'system', value } : null;
        case '/stream': {
            if (!value)
                return { type: 'stream' };
            const normalized = value.toLowerCase();
            if (['on', 'true', '1'].includes(normalized))
                return { type: 'stream', enabled: true };
            if (['off', 'false', '0'].includes(normalized))
                return { type: 'stream', enabled: false };
            return null;
        }
        default:
            return null;
    }
}
//# sourceMappingURL=commands.js.map