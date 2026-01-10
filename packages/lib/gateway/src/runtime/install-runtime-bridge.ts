import type { VacpPlaybook, VacpRuntimeBridge } from '@vacp/core';

import { VacpActionRegistry } from '../action-registry';
import { createRuntimeBridge } from './create-runtime-bridge';
import type { VacpSnapshotProvider } from './types';
import { isUpdatableRuntimeBridge } from './window-runtime-bridge';

/**
 * Install-or-update a runtime bridge at a given global key (default `__vacp`).
 *
 * This keeps `window.__vacp` stable across rerenders and view switches:
 * - the bridge object stays the same
 * - providers update the underlying snapshot/action adapters
 * - history remains continuous by default (enables real time travel and replay)
 *
 * If `sessionKey` is provided and changes between installs, the runtime bridge
 * will treat it as a new session and reset its history.
 */
export function installVacpRuntimeBridge(args: {
  snapshots: VacpSnapshotProvider;
  actions: VacpActionRegistry;
  playbooks?: VacpPlaybook[];
  globalKey?: string;
  sessionKey?: string;
}): VacpRuntimeBridge {
  const key = args.globalKey ?? '__vacp';
  const root = globalThis as unknown as Record<string, unknown>;
  const existing = root[key];
  if (isUpdatableRuntimeBridge(existing)) {
    existing.__vacpUpdate?.({
      snapshots: args.snapshots,
      actions: args.actions,
      playbooks: args.playbooks,
      sessionKey: args.sessionKey,
    });
    return existing as VacpRuntimeBridge;
  }
  const bridge = createRuntimeBridge({
    snapshots: args.snapshots,
    actions: args.actions,
    playbooks: args.playbooks,
    sessionKey: args.sessionKey,
  });
  root[key] = bridge;
  return bridge;
}
