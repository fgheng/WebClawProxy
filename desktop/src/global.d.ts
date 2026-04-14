export {};

declare global {
  interface Window {
    webclawDesktop?: {
      openExternal: (url: string) => Promise<void>;
    };
  }
}
