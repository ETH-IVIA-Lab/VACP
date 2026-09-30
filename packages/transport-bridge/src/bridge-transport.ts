import {
  vacpToolCapabilitiesRequest,
  vacpToolRead,
  vacpToolResult,
  vacpToolStateRequest,
  type VacpWindowBridge,
} from '@vacp/protocol';
import type { VacpTransport } from './types';

/**
 * Map agent tool input to the bridge's settled reads and execution, and each answer back to the
 * bounded JSON a model reads: graph reads without source ownership, cut to the shared limits.
 */
export function createVacpTransport(bridge: VacpWindowBridge): VacpTransport {
  return {
    vacp_observe: async () => vacpToolResult(vacpToolRead(await bridge.observe())),
    vacp_capabilities: async (input) =>
      vacpToolResult(vacpToolRead(await bridge.getCapabilities(vacpToolCapabilitiesRequest(input)))),
    vacp_state: async (input) => {
      const request = vacpToolStateRequest(input);
      return vacpToolResult(request ? await bridge.getState(request) : await bridge.getState());
    },
    vacp_execute: async (name, params, call_id, options) => {
      const action = name.trim();
      if (!action) throw new Error('Expected a non-empty action name');
      const call = { callId: call_id?.trim() || crypto.randomUUID(), name: action, params };
      return vacpToolResult(await bridge.execute(call, options));
    },
  };
}
