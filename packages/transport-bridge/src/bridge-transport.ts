import { vacpToolRead, type VacpWindowBridge } from '@vacp/protocol';
import type { VacpTransport } from './types';

/** Map agent tools to the provider's settled protocol reads and execution. */
export function createVacpTransport(bridge: VacpWindowBridge): VacpTransport {
  return {
    vacp_observe: async () => vacpToolRead(await bridge.observe()),
    vacp_capabilities: async (options) =>
      vacpToolRead(options ? await bridge.getCapabilities(options) : await bridge.getCapabilities()),
    vacp_state: async (options) => (options ? await bridge.getState(options) : await bridge.getState()),
    vacp_execute: async (name, params, call_id, options) => {
      const action = name.trim();
      if (!action) throw new Error('Expected a non-empty action name');
      const call = { callId: call_id?.trim() || crypto.randomUUID(), name: action, params };
      return await bridge.execute(call, options);
    },
  };
}
