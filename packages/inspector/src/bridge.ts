import { getVacpBridge } from '@vacp/runtime-browser';
import type { VacpRuntimeSnapshot } from '@vacp/protocol';

import type { VacpRuntimeBridge } from '@vacp/protocol';

export function getBridge(globalKey: string): VacpRuntimeBridge | null {
  return getVacpBridge({ globalKey }) ?? null;
}

export async function readRuntime(bridge: VacpRuntimeBridge): Promise<VacpRuntimeSnapshot> {
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
