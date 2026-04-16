export {};

declare global {
  interface Window {
    webclawDesktop?: {
      openExternal: (url: string) => Promise<void>;
      selectProvider: (provider: string) => Promise<{ provider: string; url: string }>;
      reloadCurrentProvider: () => Promise<{ url: string }>;
      openBrowserDevTools: () => Promise<void>;
      setBrowserBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
      setBrowserSplitRatio: (ratio: number) => Promise<void>;
      navigateBrowser: (url: string) => Promise<void>;
      getDesktopState: () => Promise<{
        currentProvider: string | null;
        providerSites: Record<string, string>;
        providerModels: Record<string, string[]>;
        currentUrl: string;
        serviceStatus: string;
        apiBaseUrl: string;
        cdpUrl: string;
      }>;
      startService: () => Promise<{ status: string }>;
      stopService: () => Promise<{ status: string }>;
      restartService: () => Promise<{ status: string }>;
      initTerminal: () => Promise<{ status: string; shell: string; cwd: string; pid: number | null } | undefined>;
      writeTerminal: (command: string) => Promise<void>;
      interruptTerminal: () => Promise<void>;
      resizeTerminal: (cols: number, rows: number) => Promise<void>;
      onServiceLog: (
        callback: (event: { stream: 'stdout' | 'stderr'; message: string; timestamp: number }) => void
      ) => () => void;
      onServiceStatus: (
        callback: (event: { status: string; timestamp: number }) => void
      ) => () => void;
      onServiceError: (
        callback: (event: { message: string; timestamp: number }) => void
      ) => () => void;
      onTerminalOutput: (
        callback: (event: { stream: 'stdout' | 'system'; message: string; timestamp: number }) => void
      ) => () => void;
      onTerminalStatus: (
        callback: (event: { status: string; timestamp: number; shell: string; cwd: string; pid: number | null }) => void
      ) => () => void;
    };
  }
}
