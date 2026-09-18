import type { VacpRuntimeSnapshot } from '@vacp/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { getBridge, readRuntime } from '@vacp/inspector/bridge';
import type { VacpRuntimeBridge } from '@vacp/protocol';

// TanStack Query's default retryDelay backoff can grow large. For the overlay,
// use short, bounded retries so "Connecting..." resolves quickly when a bridge
// appears a moment after the panel opens (or after a spec switch).
const BRIDGE_RETRY_DELAY_MS = 200;

const BRIDGE_RETRY_COUNT = 50;

const BRIDGE_QUERY_TIMEOUT_MS = 4_000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: number | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}

export function useVacpBridgePresence(globalKey: string) {
  return useQuery({
    queryKey: ['vacp', 'bridgePresence', globalKey],
    queryFn: () => Boolean(getBridge(globalKey)),
    staleTime: 0,
    retry: false,
    refetchInterval: (q) => (q.state.data ? false : 350),
    refetchIntervalInBackground: true,
  });
}

export function useVacpBridge(globalKey: string, enabled: boolean) {
  return useQuery({
    queryKey: ['vacp', 'bridge', globalKey],
    enabled,
    retry: BRIDGE_RETRY_COUNT,
    retryDelay: BRIDGE_RETRY_DELAY_MS,
    queryFn: async (): Promise<VacpRuntimeBridge> => {
      const b = getBridge(globalKey);

      if (!b) throw new Error(`No VACP bridge found (expected window.${globalKey}).`);

      return b;
    },
  });
}

export function useVacpRuntime(globalKey: string, bridge: VacpRuntimeBridge | null, enabled: boolean) {
  const qc = useQueryClient();
  const pendingRefetch = useRef<number | null>(null);

  const q = useQuery({
    queryKey: ['vacp', 'runtime', globalKey],
    enabled: enabled && Boolean(bridge),
    retry: BRIDGE_RETRY_COUNT,
    retryDelay: BRIDGE_RETRY_DELAY_MS,
    queryFn: async (): Promise<VacpRuntimeSnapshot> => {
      if (!bridge) throw new Error('Missing VACP bridge');

      return await withTimeout(readRuntime(bridge), BRIDGE_QUERY_TIMEOUT_MS, 'readRuntime');
    },
  });

  useEffect(() => {
    if (!bridge || !enabled) return;

    if (typeof bridge.subscribe !== 'function') return;

    const unsubscribe = bridge.subscribe(() => {
      if (pendingRefetch.current) return;
      pendingRefetch.current = window.setTimeout(() => {
        pendingRefetch.current = null;
        void qc.invalidateQueries({ queryKey: ['vacp', 'runtime', globalKey] });
      }, 60);
    });

    return () => {
      unsubscribe();

      if (pendingRefetch.current) window.clearTimeout(pendingRefetch.current);
      pendingRefetch.current = null;
    };
  }, [bridge, enabled, globalKey, qc]);

  return q;
}
