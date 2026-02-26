import type { VacpChangeSource } from '@vacp/core';

import type { VacpBridgeLike, VacpTransportContract } from './types';

function messageForExecute(action: string): string {
  return `agent:${action}`;
}

async function ensureLiveMode(bridge: VacpBridgeLike) {
  if (typeof bridge.getRuntime !== 'function' || typeof bridge.setMode !== 'function') return;
  try {
    const runtime = await bridge.getRuntime();
    if (runtime.mode === 'inspect') bridge.setMode('live', { source: 'agent', message: 'auto:live for execute' });
  } catch {
    // keep execute best-effort even if runtime snapshot is unavailable
  }
}

export function createWindowVacpTransport(bridge: VacpBridgeLike): VacpTransportContract {
  return {
    vacp_capabilities: async (options) => {
      if (!options) return await bridge.getCapabilities();
      return await bridge.getCapabilities(options);
    },

    vacp_state: async (options) => {
      if (!options) return await bridge.getState();
      return await bridge.getState(options);
    },

    vacp_execute: async (name, params, call_id) => {
      const action = name?.trim();
      if (!action) throw new Error('Expected a non-empty action name');

      await ensureLiveMode(bridge);

      const callId = call_id?.trim() || crypto.randomUUID();
      if (typeof bridge.dispatch === 'function') {
        return await bridge.dispatch(
          { callId, name: action, params },
          { source: 'agent' as VacpChangeSource, message: messageForExecute(action) },
        );
      }

      return await bridge.execute({ callId, name: action, params });
    },
  };
}
