import type { VacpRuntimeSnapshot } from '@vacp/protocol';
import type { VacpInspectorBridgeStatus } from '@vacp/inspector/overlay/inspector-view';
import { useEffect, useMemo, useState } from 'react';

type RuntimeHealthEventDetail = {
  kind: 'console' | 'error' | 'network';
  message: string;
};

type RuntimeHealthCounters = {
  consoleErrors: number;
  runtimeErrors: number;
  networkFailures: number;
  lastIssue: string | null;
};

export type RuntimeHealthSnapshot = RuntimeHealthCounters & {
  bridgeStatus: VacpInspectorBridgeStatus;
  providerStatus: 'ok' | 'missing' | 'error' | 'unknown';
  mode: string;
  historyLength: number;
};

const EVENT_NAME = 'vacp-inspector-runtime-health';

let healthConsumers = 0;
let restoreInstrumentation: (() => void) | undefined;

function emitRuntimeHealth(detail: RuntimeHealthEventDetail): void {
  if (healthConsumers > 0) window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
}

function installRuntimeHealthInstrumentation(): () => void {
  healthConsumers += 1;

  if (!restoreInstrumentation) {
    const originalConsoleError = console.error;
    const originalFetch = window.fetch;
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const requestUrls = new WeakMap<XMLHttpRequest, string>();

    const patchedConsoleError: typeof console.error = (...args) => {
      emitRuntimeHealth({ kind: 'console', message: args.map(String).join(' ') });
      originalConsoleError.apply(console, args);
    };

    const patchedFetch: typeof fetch = async (...args) => {
      try {
        const response = await originalFetch.apply(window, args);
        if (!response.ok) {
          emitRuntimeHealth({
            kind: 'network',
            message: `fetch ${response.status} ${response.statusText} ${String(args[0])}`,
          });
        }
        return response;
      } catch (cause) {
        emitRuntimeHealth({ kind: 'network', message: `fetch failed ${String(args[0])}: ${String(cause)}` });
        throw cause;
      }
    };

    const patchedOpen: typeof XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      async: boolean = true,
      username?: string | null,
      password?: string | null,
    ) {
      requestUrls.set(this, String(url));
      return originalOpen.call(this, method, url, async, username, password);
    };

    const patchedSend: typeof XMLHttpRequest.prototype.send = function (
      this: XMLHttpRequest,
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      const url = requestUrls.get(this) ?? 'xhr';
      const onError = () => emitRuntimeHealth({ kind: 'network', message: `xhr failed ${url}` });
      const onEnd = () => {
        this.removeEventListener('error', onError);
        if (this.status >= 400) emitRuntimeHealth({ kind: 'network', message: `xhr ${this.status} ${url}` });
      };
      this.addEventListener('error', onError, { once: true });
      this.addEventListener('loadend', onEnd, { once: true });
      return originalSend.call(this, body);
    };

    const onError = (event: ErrorEvent) =>
      emitRuntimeHealth({ kind: 'error', message: event.message || 'window error' });
    const onRejection = (event: PromiseRejectionEvent) =>
      emitRuntimeHealth({ kind: 'error', message: String(event.reason ?? 'unhandled rejection') });
    console.error = patchedConsoleError;
    window.fetch = patchedFetch;
    XMLHttpRequest.prototype.open = patchedOpen;
    XMLHttpRequest.prototype.send = patchedSend;
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    restoreInstrumentation = () => {
      if (console.error === patchedConsoleError) console.error = originalConsoleError;
      if (window.fetch === patchedFetch) window.fetch = originalFetch;
      if (XMLHttpRequest.prototype.open === patchedOpen) XMLHttpRequest.prototype.open = originalOpen;
      if (XMLHttpRequest.prototype.send === patchedSend) XMLHttpRequest.prototype.send = originalSend;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    healthConsumers -= 1;
    if (healthConsumers === 0) {
      restoreInstrumentation?.();
      restoreInstrumentation = undefined;
    }
  };
}

export function useRuntimeHealth(args: {
  bridgeStatus: VacpInspectorBridgeStatus;
  runtime: VacpRuntimeSnapshot | null;
  bridgeError: unknown;
  runtimeError: unknown;
}): RuntimeHealthSnapshot {
  const [counters, setCounters] = useState<RuntimeHealthCounters>({
    consoleErrors: 0,
    runtimeErrors: 0,
    networkFailures: 0,
    lastIssue: null,
  });

  useEffect(() => {
    const dispose = installRuntimeHealthInstrumentation();

    const onHealth = (event: Event) => {
      const detail = (event as CustomEvent<RuntimeHealthEventDetail>).detail;

      if (!detail) return;
      setCounters((prev) => ({
        consoleErrors: prev.consoleErrors + (detail.kind === 'console' ? 1 : 0),
        runtimeErrors: prev.runtimeErrors + (detail.kind === 'error' ? 1 : 0),
        networkFailures: prev.networkFailures + (detail.kind === 'network' ? 1 : 0),
        lastIssue: detail.message,
      }));
    };

    window.addEventListener(EVENT_NAME, onHealth);

    return () => {
      window.removeEventListener(EVENT_NAME, onHealth);
      dispose();
    };
  }, []);

  return useMemo(() => {
    const providerStatus =
      args.bridgeStatus === 'missing'
        ? 'missing'
        : args.bridgeError || args.runtimeError
          ? 'error'
          : args.runtime
            ? 'ok'
            : 'unknown';

    return {
      ...counters,
      bridgeStatus: args.bridgeStatus,
      providerStatus,
      mode: args.runtime?.mode ?? 'unknown',
      historyLength: args.runtime?.history.length ?? 0,
    };
  }, [args.bridgeError, args.bridgeStatus, args.runtime, args.runtimeError, counters]);
}
