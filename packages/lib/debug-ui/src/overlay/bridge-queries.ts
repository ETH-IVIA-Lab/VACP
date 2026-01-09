import type { VacpPlaybook, VacpRuntimeSnapshot } from '@vacp/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { getBridge, readPlaybooks, readRuntime } from '@vacp/debug-ui/bridge';
import type { VacpWindowBridge } from '@vacp/debug-ui/types';

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
    retry: 25,
    queryFn: async (): Promise<VacpWindowBridge> => {
      const b = getBridge(globalKey);
      if (!b) throw new Error(`No VACP bridge found (expected window.${globalKey}).`);
      return b;
    },
  });
}

export function useVacpRuntime(globalKey: string, bridge: VacpWindowBridge | null, enabled: boolean) {
  const qc = useQueryClient();
  const pendingRefetch = useRef<number | null>(null);

  const q = useQuery({
    queryKey: ['vacp', 'runtime', globalKey],
    enabled: enabled && Boolean(bridge),
    retry: 25,
    queryFn: async (): Promise<VacpRuntimeSnapshot> => {
      if (!bridge) throw new Error('Missing VACP bridge');
      return await readRuntime(bridge);
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

export function useVacpPlaybooks(
  globalKey: string,
  bridge: VacpWindowBridge | null,
  runtimeId: string | null | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['vacp', 'playbooks', globalKey, runtimeId ?? null],
    enabled: enabled && Boolean(bridge),
    retry: 25,
    queryFn: async (): Promise<VacpPlaybook[]> => {
      if (!bridge) throw new Error('Missing VACP bridge');
      return await readPlaybooks(bridge);
    },
  });
}
