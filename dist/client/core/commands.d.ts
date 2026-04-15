export type ParsedCommand = {
    type: 'help' | 'clear' | 'reset' | 'history' | 'config' | 'trace' | 'new' | 'quit' | 'exit';
} | {
    type: 'model' | 'system';
    value: string;
} | {
    type: 'provider';
    value: string;
} | {
    type: 'stream';
    enabled?: boolean;
};
export declare function parseCommand(input: string): ParsedCommand | null;
//# sourceMappingURL=commands.d.ts.map