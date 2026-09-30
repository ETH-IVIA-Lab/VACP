import assert from 'node:assert/strict';
import test from 'node:test';

import { createVacpTransport } from '../src/index';

test('graph reads reach the agent without source ownership, and state as read', async () => {
  const graph = {
    version: '1.0.0',
    sources: [{ id: 'vacp-source://chart', type: 'chart' }],
    nodes: [{ ref: 'vacp://chart/a', kind: 'Mark' }],
    edges: [],
    actions: [{ name: 'chart.set' }],
  };
  const snapshot = {
    createdAt: '2026-01-01T00:00:00.000Z',
    version: '1.0.0',
    graph: {
      ...graph,
      ownership: {
        nodes: { 'vacp://chart/a': 'vacp-source://chart' },
        actions: { 'chart.set': 'vacp-source://chart' },
      },
    },
  };
  const expectedCaps = { ...snapshot, graph };

  const expectedState = { createdAt: '2026-01-01T00:00:00.000Z', version: '1.0.0', state: {} };

  const expectedUpdate = {
    createdAt: '2026-01-01T00:00:00.000Z',
    version: '1.0.0',
    mode: 'full' as const,
    token: 'st_test',
    snapshot: expectedState,
  };

  let gotStateOptions: unknown = null;
  let gotCapabilitiesOptions: unknown = null;

  const bridge = {
    getCapabilities: async (options?: unknown) => {
      gotCapabilitiesOptions = options ?? null;

      return snapshot;
    },
    getState: async (options?: unknown) => {
      gotStateOptions = options ?? null;

      return options ? expectedUpdate : expectedState;
    },
    execute: async () => ({ callId: 'unused', ok: true }),
  };

  const transport = createVacpTransport(bridge);
  assert.deepEqual(await transport.vacp_capabilities(), expectedCaps);
  assert.deepEqual(gotCapabilitiesOptions, { includeNodeData: false });
  const capabilitiesOptions = { prefixes: ['vacp://chart'], includeNodeData: true };
  assert.deepEqual(await transport.vacp_capabilities(capabilitiesOptions), expectedCaps);
  assert.deepEqual(gotCapabilitiesOptions, capabilitiesOptions);
  assert.deepEqual(await transport.vacp_state(), expectedState);
  assert.equal(gotStateOptions, null);

  const stateOptions = {
    mode: 'delta' as const,
    since: 'st_prev',
    refs: ['vacp://chart/a'] as const,
    includeSummary: false,
  };

  assert.deepEqual(await transport.vacp_state(stateOptions), expectedUpdate);
  assert.deepEqual(gotStateOptions, stateOptions);
});

test('empty reads stay authoritative and execution forwards the call', async () => {
  let reads = 0;
  const transport = createVacpTransport({
    observe: async () => ({ revision: 'empty', graph: { nodes: [], edges: [], actions: [] }, state: {} }),
    getCapabilities: async () => {
      reads++;
      return { graph: { nodes: [], edges: [], actions: [] } };
    },
    getState: async () => {
      reads++;
      return { state: {} };
    },
    execute: async (call) => ({ callId: call.callId, ok: true, result: call.params }),
  });
  assert.equal((await transport.vacp_observe()).revision, 'empty');
  assert.deepEqual((await transport.vacp_capabilities()).graph.nodes, []);
  assert.deepEqual((await transport.vacp_state()).state, {});
  assert.equal(reads, 2);
  assert.deepEqual(await transport.vacp_execute('set', { value: 2 }, 'test'), {
    callId: 'test',
    ok: true,
    result: { value: 2 },
  });
});

test('a bare vacp:// scope reads everything, and an unscoped graph read leaves out node data', async () => {
  const requests: Array<{ read: string; request: unknown }> = [];
  const transport = createVacpTransport({
    getCapabilities: async (request?: unknown) => {
      requests.push({ read: 'capabilities', request: request ?? null });
      return { graph: { nodes: [], edges: [], actions: [] } };
    },
    getState: async (request?: unknown) => {
      requests.push({ read: 'state', request: request ?? null });
      return { state: {} };
    },
    execute: async (call) => ({ callId: call.callId, ok: true }),
  });
  await transport.vacp_capabilities({ refs: ['vacp://'] });
  await transport.vacp_capabilities({ prefixes: ['vacp://', 'vacp://chart/'] });
  await transport.vacp_state({ refs: ['vacp://'] });
  assert.deepEqual(requests, [
    { read: 'capabilities', request: { includeNodeData: false } },
    { read: 'capabilities', request: { prefixes: ['vacp://chart/'] } },
    { read: 'state', request: null },
  ]);
});
