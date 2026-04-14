export {};

declare global {
  interface Window {
    webclawDesktop?: {
      openExternal: (url: string) => Promise<void>;
      selectProvider: (provider: string) => Promise<{ provider: string; url: string }>;
      reloadCurrentProvider: () => Promise<{ url: string }>;
      openBrowserDevTools: () => Promise<void>;
      getDesktopState: () => Promise<{
        currentProvider: string | null;
        providerSites: Record<string, string>;
        currentUrl: string;
        serviceStatus: string;
        cdpUrl: string;
      }>;
      startService: () => Promise<{ status: string }>;
      stopService: () => Promise<{ status: string }>;
      restartService: () => Promise<{ status: string }>;
      onServiceLog: (
        callback: (event: { stream: 'stdout' | 'stderr'; message: string; timestamp: number }) => void
      ) => () => void;
      onServiceStatus: (
        callback: (event: { status: string; timestamp: number }) => void
      ) => () => void;
    };
  }
}
