import { getVacpBridge } from '@vacp/runtime-browser';
import type { VacpRuntimeSnapshot } from '@vacp/protocol';

import type { VacpRuntimeBridge } from '@vacp/protocol';

export function getBridge(globalKey: string): VacpRuntimeBridge | null {
  return getVacpBridge({ globalKey }) ?? null;
}

export async function readRuntime(bridge: VacpRuntimeBridge): Promise<VacpRuntimeSnapshot> {
  if (typeof bridge.getRuntime === 'function') return await bridge.getRuntime();
  const observation = await bridge.observe();
  const capabilities = { version: observation.version, createdAt: observation.observedAt, graph: observation.graph };
  const state = {
    version: observation.version,
    createdAt: observation.observedAt,
    state: observation.state,
    summary: observation.summary,
  };

  return {
    version: capabilities.version,
    mode: 'live',
    cursor: -1,
    history: [],
    liveObservation: observation,
    currentObservation: observation,
    liveCapabilities: capabilities,
    liveState: state,
    currentCapabilities: capabilities,
    currentState: state,
  };
}
