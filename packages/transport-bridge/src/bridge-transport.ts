import { vacpToolCapabilitiesRequest, vacpToolRead, vacpToolStateRequest, type VacpWindowBridge } from '@vacp/protocol';
import type { VacpTransport } from './types';

/** Map agent tool input to the bridge's settled reads and execution, and its graph reads back to tool reads. */
export function createVacpTransport(bridge: VacpWindowBridge): VacpTransport {
  return {
    vacp_observe: async () => vacpToolRead(await bridge.observe()),
    vacp_capabilities: async (input) => vacpToolRead(await bridge.getCapabilities(vacpToolCapabilitiesRequest(input))),
    vacp_state: async (input) => {
      const request = vacpToolStateRequest(input);
      return request ? await bridge.getState(request) : await bridge.getState();
    },
    vacp_execute: async (name, params, call_id, options) => {
      const action = name.trim();
      if (!action) throw new Error('Expected a non-empty action name');
      const call = { callId: call_id?.trim() || crypto.randomUUID(), name: action, params };
      return await bridge.execute(call, options);
    },
  };
}
