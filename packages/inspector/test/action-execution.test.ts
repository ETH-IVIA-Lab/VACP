import assert from 'node:assert/strict';
import test from 'node:test';

import type { VacpActionCall, VacpActionResult } from '@vacp/protocol';
import { VACP_SCHEMA_VERSION } from '@vacp/protocol';

import { executeInspectorAction } from '../src/overlay/modules/action-execution';
import type { VacpWindowBridge } from '../src/types';

function bridgeWithActions(actions: Pick<VacpWindowBridge, 'execute' | 'dispatch'>): VacpWindowBridge {
  return {
    version: VACP_SCHEMA_VERSION,
    getCapabilities: async () => {
      throw new Error('getCapabilities is not used by action execution tests');
    },
    getState: async () => {
      throw new Error('getState is not used by action execution tests');
    },
    ...actions,
  };
}

test('inspector action execution uses the standard window bridge contract', async () => {
  const call: VacpActionCall = { callId: 'call-1', name: 'vacp.example', params: { value: 1 } };
  const result: VacpActionResult = { callId: call.callId, ok: true, result: { accepted: true } };
  let executedCall: VacpActionCall | null = null;

  const bridge = bridgeWithActions({
    execute: async (nextCall) => {
      executedCall = nextCall;

      return result;
    },
  });

  const received = await executeInspectorAction(bridge, call, { source: 'inspector', message: 'run' });

  assert.deepEqual(executedCall, call);
  assert.deepEqual(received, result);
});

test('inspector action execution preserves inspector metadata on runtime bridges', async () => {
  const call: VacpActionCall = { callId: 'call-2', name: 'vacp.example', params: { value: 2 } };
  const result: VacpActionResult = { callId: call.callId, ok: true };
  let dispatchedCall: VacpActionCall | null = null;
  let dispatchedOptions: { source?: string; message?: string } | undefined;

  const bridge = bridgeWithActions({
    execute: async () => {
      throw new Error('execute should not run when dispatch is available');
    },
    dispatch: async (nextCall, options) => {
      dispatchedCall = nextCall;
      dispatchedOptions = options;

      return result;
    },
  });

  const received = await executeInspectorAction(bridge, call, { source: 'inspector', message: 'schema' });

  assert.deepEqual(dispatchedCall, call);
  assert.deepEqual(dispatchedOptions, { source: 'inspector', message: 'schema' });
  assert.deepEqual(received, result);
});
