export {};

declare global {
  interface Window {
    webclawDesktop?: {
      openExternal: (url: string) => Promise<void>;
      selectProvider: (provider: string) => Promise<{ provider: string; url: string }>;
      reloadCurrentProvider: () => Promise<{ url: string }>;
      openBrowserDevTools: () => Promise<void>;
      showBrowserWaiting: () => Promise<{ url: string }>;
      showBrowserMonitor: (url: string) => Promise<{ url: string }>;
      resetBrowser: () => Promise<{ ok: boolean }>;
      setBrowserBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
      setBrowserSplitRatio: (ratio: number) => Promise<void>;
      navigateBrowser: (url: string) => Promise<void>;
      setTheme: (theme: 'dark' | 'light') => Promise<{ ok: boolean; theme: 'dark' | 'light' }>;
      getDesktopState: () => Promise<{
        currentProvider: string | null;
        providerSites: Record<string, string>;
        providerModels: Record<string, string[]>;
        providerDefaultModes: Record<string, 'web' | 'forward'>;
        providerInputMaxChars: Record<string, number | null>;
        providerForwardBaseUrls: Record<string, string>;
        providerApiKeys: Record<string, string>;
        providerApiKeyMasked: Record<string, string>;
        currentUrl: string;
        serviceStatus: string;
        servicePort: number;
        apiBaseUrl: string;
        cdpUrl: string;
        promptConfig: {
          init_prompt: string;
          init_prompt_template: string;
          user_message_template: string;
          response_schema_template: string;
          format_only_retry_template: string;
        } | null;
      }>;
      updateProviderConfig: (payload: { provider: string; models?: string[]; defaultMode?: 'web' | 'forward'; inputMaxChars?: number | null; forwardBaseUrl?: string; apiKey?: string }) => Promise<{
        ok: boolean;
        providerSites: Record<string, string>;
        providerModels: Record<string, string[]>;
        providerDefaultModes: Record<string, 'web' | 'forward'>;
        providerInputMaxChars: Record<string, number | null>;
        providerForwardBaseUrls: Record<string, string>;
        providerApiKeys: Record<string, string>;
        providerApiKeyMasked: Record<string, string>;
      }>;
      updateSettings: (payload: { servicePort: number }) => Promise<{
        ok: boolean;
        servicePort: number;
      }>;
      updatePromptConfig: (payload: {
        init_prompt: string;
        init_prompt_template: string;
        user_message_template: string;
        response_schema_template: string;
        format_only_retry_template: string;
      }) => Promise<{
        ok: boolean;
        promptConfig: {
          init_prompt: string;
          init_prompt_template: string;
          user_message_template: string;
          response_schema_template: string;
          format_only_retry_template: string;
        };
      }>;
      startService: () => Promise<{ status: string }>;
      stopService: () => Promise<{ status: string }>;
      restartService: () => Promise<{ status: string }>;
      initTerminal: () => Promise<{ terminals: Array<{ terminalId: string; status: string; backend: 'pty' | 'raw' | null; shell: string; cwd: string; pid: number | null }>; activeTerminalId: string | null } | undefined>;
      listTerminals: () => Promise<{ terminals: Array<{ terminalId: string; status: string; backend: 'pty' | 'raw' | null; shell: string; cwd: string; pid: number | null }> } | undefined>;
      createTerminal: (options?: { shell?: string; cwd?: string }) => Promise<{ terminalId: string; status: string; backend: 'pty' | 'raw' | null; shell: string; cwd: string; pid: number | null } | undefined>;
      closeTerminal: (terminalId: string) => Promise<{ closed: boolean } | undefined>;
      writeTerminal: (terminalId: string, command: string) => Promise<void>;
      interruptTerminal: (terminalId: string) => Promise<void>;
      resizeTerminal: (terminalId: string, cols: number, rows: number) => Promise<void>;
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
        callback: (event: { terminalId: string; stream: 'stdout' | 'system'; message: string; timestamp: number }) => void
      ) => () => void;
      onTerminalStatus: (
        callback: (event: { terminalId: string; status: string; backend: 'pty' | 'raw' | null; timestamp: number; shell: string; cwd: string; pid: number | null }) => void
      ) => () => void;
    };
  }
}
