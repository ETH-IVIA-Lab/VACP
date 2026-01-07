import type { VacpDemo, VacpRuntimeSnapshot } from '@vacp/core';

import type { VacpWindowBridge } from './types';

export function getBridge(globalKey: string): VacpWindowBridge | null {
  const root = globalThis as unknown as Record<string, unknown>;
  const b = root[globalKey];
  if (!b || typeof b !== 'object') return null;
  const maybe = b as Partial<VacpWindowBridge>;
  if (typeof maybe.getCapabilities !== 'function' || typeof maybe.getState !== 'function') return null;
  return maybe as VacpWindowBridge;
}

export async function readRuntime(bridge: VacpWindowBridge): Promise<VacpRuntimeSnapshot> {
  if (typeof bridge.getRuntime === 'function') return await bridge.getRuntime();
  const [capabilities, state] = await Promise.all([bridge.getCapabilities(), bridge.getState()]);
  return {
    version: capabilities.version,
    mode: 'live',
    cursor: -1,
    history: [],
    liveCapabilities: capabilities,
    liveState: state,
    currentCapabilities: capabilities,
    currentState: state,
  };
}

export async function readDemos(bridge: VacpWindowBridge): Promise<VacpDemo[]> {
  if (typeof bridge.getDemos !== 'function') return [];
  const res = await bridge.getDemos();
  return Array.isArray(res) ? res : [];
}
