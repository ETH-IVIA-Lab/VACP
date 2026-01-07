import type { VacpDemo, VacpPlaybook, VacpRuntimeBridge } from '@vacp/core';

import { VacpActionRegistry } from '../action-registry';
import { createRuntimeBridge } from './create-runtime-bridge';
import type { VacpSnapshotProvider } from './types';
import { isRuntimeBridge } from './window-runtime-bridge';

/**
 * Install-or-update a runtime bridge at a given global key (default `__vacp`).
 *
 * This keeps `window.__vacp` stable across rerenders and view switches:
 * - the bridge object stays the same
 * - providers update the underlying snapshot/action adapters
 * - history remains continuous (enables real time travel and replay)
 */
export function installVacpRuntimeBridge(args: {
  snapshots: VacpSnapshotProvider;
  actions: VacpActionRegistry;
  demos?: VacpPlaybook[];
  globalKey?: string;
}): VacpRuntimeBridge {
  const key = args.globalKey ?? '__vacp';
  const root = globalThis as unknown as Record<string, unknown>;
  const existing = root[key];
  if (isRuntimeBridge(existing)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upd = (existing as any).__vacpUpdate as
      | undefined
      | ((next: { snapshots: VacpSnapshotProvider; actions: VacpActionRegistry; demos?: VacpDemo[] }) => void);
    if (typeof upd === 'function') {
      upd({ snapshots: args.snapshots, actions: args.actions, demos: args.demos });
      return existing as VacpRuntimeBridge;
    }
  }
  const bridge = createRuntimeBridge({ snapshots: args.snapshots, actions: args.actions, demos: args.demos });
  root[key] = bridge;
  return bridge;
}
