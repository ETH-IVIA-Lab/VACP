import type { ExampleOptions } from '../../../examples/config';
import type { VacpAgentActivityControl, VacpAgentActivityHandle, VacpRuntimeBridge } from '@vacp/protocol';

declare global {
  var __vacpExampleOptions: Partial<ExampleOptions> | undefined;
  interface Window {
    __vacpStream?: VacpAgentActivityHandle;
    __vacp?: VacpRuntimeBridge & VacpAgentActivityControl;
    __vacpDownloadProbe?: Array<{ filename: string; text: string }>;
    __vacpHostHooks?: {
      fetch: typeof fetch;
      open: XMLHttpRequest['open'];
      send: XMLHttpRequest['send'];
      error: typeof console.error;
    };
  }
}
