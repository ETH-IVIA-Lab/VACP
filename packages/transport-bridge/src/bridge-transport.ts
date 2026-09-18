import type { VacpWindowBridge } from '@vacp/protocol';
import type { VacpTransport } from './types.js';

/** Map agent tools to the provider's settled protocol reads and execution. */
export function createVacpTransport(bridge: VacpWindowBridge): VacpTransport {
  return {
    vacp_observe: async () => await bridge.observe(),
    vacp_capabilities: async (options) =>
      options ? await bridge.getCapabilities(options) : await bridge.getCapabilities(),
    vacp_state: async (options) => (options ? await bridge.getState(options) : await bridge.getState()),
    vacp_execute: async (name, params, call_id) => {
      const action = name.trim();
      if (!action) throw new Error('Expected a non-empty action name');
      return await bridge.execute({ callId: call_id?.trim() || crypto.randomUUID(), name: action, params });
    },
  };
}
