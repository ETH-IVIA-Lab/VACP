import {
  parseVacpNarration,
  vacpAgentActor,
  vacpToolCapabilitiesRequest,
  vacpToolRead,
  vacpToolResult,
  vacpToolStateRequest,
  type VacpActor,
} from '../protocol';
import type { VacpToolHandlers, VacpToolBridge } from './types';

/**
 * Map agent tool input to the bridge's reads, execution, and narration, attributed to `actor`, and
 * each answer back to the bounded JSON a model reads.
 */
export function createVacpToolHandlers(
  bridge: VacpToolBridge,
  { actor = vacpAgentActor }: { actor?: VacpActor } = {},
): VacpToolHandlers {
  return {
    vacp_observe: async () => vacpToolResult(vacpToolRead(await bridge.observe())),
    vacp_capabilities: async (input) =>
      vacpToolResult(vacpToolRead(await bridge.getCapabilities(vacpToolCapabilitiesRequest(input)))),
    vacp_state: async (input) => vacpToolResult(await bridge.getState(vacpToolStateRequest(input))),
    vacp_execute: async ({ name, params, narration, callId }, signal) => {
      const action = name.trim();
      if (!action) throw new TypeError('Expected a non-empty action name');
      const call = { callId, name: action, params };
      return vacpToolResult(await bridge.execute(call, { actor, narration: parseVacpNarration(narration), signal }));
    },
    vacp_progress: async ({ message, done = false }, signal) => {
      bridge.narrate({ actor, message: parseVacpNarration(message, 'message'), done, signal });
      return { ok: true };
    },
  };
}
