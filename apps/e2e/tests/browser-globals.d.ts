import type { VacpRuntimeBridge } from '@vacp/protocol';

declare global {
  interface Window {
    __vacp?: VacpRuntimeBridge;
    __vacpDownloadProbe?: Array<{ filename: string; text: string }>;
    __vacpHostHooks?: {
      fetch: typeof fetch;
      open: XMLHttpRequest['open'];
      send: XMLHttpRequest['send'];
      error: typeof console.error;
    };
  }
}
