import type { VacpRuntimeSnapshot } from '@vacp/core';
import type { VacpDebugBridgeStatus } from '@vacp/debug-ui/overlay/debug-ui-view';
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
  bridgeStatus: VacpDebugBridgeStatus;
  providerStatus: 'ok' | 'missing' | 'error' | 'unknown';
  mode: string;
  historyLength: number;
};

const EVENT_NAME = 'vacp-debug-ui-runtime-health';
const INSTALL_KEY = '__vacpDebugUiRuntimeHealthInstalled';

function emitRuntimeHealth(detail: RuntimeHealthEventDetail): void {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
}

function installRuntimeHealthInstrumentation(): void {
  const host = window as typeof window & {
    [INSTALL_KEY]?: boolean;
    __vacpDebugUiOriginalConsoleError?: typeof console.error;
    __vacpDebugUiOriginalFetch?: typeof fetch;
    __vacpDebugUiOriginalXHROpen?: typeof XMLHttpRequest.prototype.open;
    __vacpDebugUiOriginalXHRSend?: typeof XMLHttpRequest.prototype.send;
  };
  if (host[INSTALL_KEY]) return;
  host[INSTALL_KEY] = true;

  host.__vacpDebugUiOriginalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    emitRuntimeHealth({ kind: 'console', message: args.map(String).join(' ') });
    host.__vacpDebugUiOriginalConsoleError?.(...args);
  };

  host.__vacpDebugUiOriginalFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    try {
      const response = await host.__vacpDebugUiOriginalFetch!(...args);
      if (!response.ok) {
        emitRuntimeHealth({
          kind: 'network',
          message: `fetch ${response.status} ${response.statusText} ${String(args[0])}`,
        });
      }
      return response;
    } catch (error) {
      emitRuntimeHealth({ kind: 'network', message: `fetch failed ${String(args[0])}: ${String(error)}` });
      throw error;
    }
  };

  host.__vacpDebugUiOriginalXHROpen = XMLHttpRequest.prototype.open;
  host.__vacpDebugUiOriginalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function patchedOpen(method: string, url: string | URL, ...rest: unknown[]) {
    (this as XMLHttpRequest & { __vacpDebugUiUrl?: string }).__vacpDebugUiUrl = String(url);
    return host.__vacpDebugUiOriginalXHROpen!.apply(this, [method, url, ...rest] as Parameters<
      typeof XMLHttpRequest.prototype.open
    >);
  };
  XMLHttpRequest.prototype.send = function patchedSend(body?: Document | XMLHttpRequestBodyInit | null) {
    const xhr = this as XMLHttpRequest & { __vacpDebugUiUrl?: string };
    const url = xhr.__vacpDebugUiUrl ?? 'xhr';
    xhr.addEventListener('error', () => {
      emitRuntimeHealth({ kind: 'network', message: `xhr failed ${url}` });
    });
    xhr.addEventListener('loadend', () => {
      if (xhr.status >= 400) emitRuntimeHealth({ kind: 'network', message: `xhr ${xhr.status} ${url}` });
    });
    return host.__vacpDebugUiOriginalXHRSend!.call(this, body);
  };

  window.addEventListener('error', (event) => {
    emitRuntimeHealth({ kind: 'error', message: event.message || 'window error' });
  });
  window.addEventListener('unhandledrejection', (event) => {
    emitRuntimeHealth({ kind: 'error', message: String(event.reason ?? 'unhandled rejection') });
  });
}

export function useRuntimeHealth(args: {
  bridgeStatus: VacpDebugBridgeStatus;
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
    installRuntimeHealthInstrumentation();
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
    return () => window.removeEventListener(EVENT_NAME, onHealth);
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
