declare module 'node-pty' {
  export type IPty = {
    pid?: number;
    kill: () => void;
    resize: (cols: number, rows: number) => void;
    write: (data: string) => void;
    onData: (listener: (data: string) => void) => void;
    onExit: (listener: (event: { exitCode: number; signal: number }) => void) => void;
  };
  export function spawn(
    file: string,
    args: string[],
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string | undefined>;
    }
  ): IPty;
}
