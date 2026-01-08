import type { VacpPlaybook, VacpRuntimeSnapshot } from '@vacp/core';

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

export async function readPlaybooks(bridge: VacpWindowBridge): Promise<VacpPlaybook[]> {
  const [demosRaw, playbooksRaw] = await Promise.all([
    typeof bridge.getDemos === 'function' ? bridge.getDemos() : Promise.resolve(null),
    typeof bridge.getPlaybooks === 'function' ? bridge.getPlaybooks() : Promise.resolve(null),
  ]);

  const merged: VacpPlaybook[] = [];
  const seen = new Set<string>();

  const add = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const pb = item as VacpPlaybook;
      const key = typeof pb.id === 'string' && pb.id ? pb.id : `${pb.title ?? ''}:${pb.steps?.length ?? 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(pb);
    }
  };

  // Prefer demos first: they are typically the most example-specific, curated sequences.
  add(demosRaw);
  add(playbooksRaw);
  return merged;
}
