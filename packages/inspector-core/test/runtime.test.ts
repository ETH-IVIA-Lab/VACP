import assert from 'node:assert/strict';
import test from 'node:test';
import { createVacpProvider, createVacpRuntime, VacpActionRegistry } from '@vacp/runtime';
import { VACP_SCHEMA_VERSION } from '@vacp/protocol';
import { createInspectorSession } from '../src/index';
import { createRuntimeInspectorClient } from '../src/runtime';
import { whenState } from './fixtures';

test('runtime connections observe and execute against a host-owned provider', async () => {
  let value = 0;
  const actions = new VacpActionRegistry();
  actions.register(
    {
      name: 'increment',
      description: 'Increment the parameter',
      operation: { kind: 'mutation', affects: ['vacp://value'] },
    },
    async () => {
      value++;
      return value;
    },
  );
  const runtime = createVacpRuntime({
    providers: [
      createVacpProvider({
        source: { id: 'vacp-source://test', type: 'test', title: 'Test' },
        actions,
        project: () => ({
          graph: {
            version: VACP_SCHEMA_VERSION,
            nodes: [{ ref: 'vacp://value', kind: 'Param', layer: 'ConfigLayer' }],
            edges: [],
          },
          state: { 'vacp://value': value },
        }),
      }),
    ],
  });
  const session = createInspectorSession(
    createRuntimeInspectorClient({ id: runtime.runtimeId, title: 'Test', runtime }),
  );
  try {
    const ready = whenState(session, (state) => state.status === 'ready');
    session.start();
    await ready;
    assert.equal(session.getState().observation?.state['vacp://value'], 0);
    await session.execute({ callId: 'increment', name: 'increment' });
    await whenState(session, (state) => state.observation?.state['vacp://value'] === 1);
    assert.equal(session.getState().observation?.state['vacp://value'], 1);
    session.dispose();
    assert.equal((await runtime.observe()).state['vacp://value'], 1);
  } finally {
    session.dispose();
    runtime.dispose();
  }
});
