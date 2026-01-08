import type { VacpPlaybook, VacpRuntimeBridge, VacpWindowBridge } from '@vacp/core';

import { VacpActionRegistry } from '../action-registry';
import { createRuntimeBridge } from './create-runtime-bridge';
import type { VacpSnapshotProvider } from './types';

/**
 * Helper to build a window bridge from a snapshot provider + action registry.
 *
 * This is intended for in-browser integrations. Conceptually this creates the
 * "agent-facing API surface" for an app:
 * - capabilities() to discover nodes/actions
 * - state() to read current selections/params
 * - execute() to request semantic interactions
 */
export function createVacpWindowBridge(args: {
  snapshots: VacpSnapshotProvider;
  actions: VacpActionRegistry;
  playbooks?: VacpPlaybook[];
}): VacpRuntimeBridge {
  return createRuntimeBridge(args);
}

export function isRuntimeBridge(value: unknown): value is VacpRuntimeBridge {
  if (!value || typeof value !== 'object') return false;
  const b = value as Partial<VacpWindowBridge>;
  return typeof b.getCapabilities === 'function' && typeof b.getState === 'function' && typeof b.execute === 'function';
}
