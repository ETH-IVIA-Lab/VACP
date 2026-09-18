import assert from 'node:assert/strict';
import test from 'node:test';

import { createVacpTransport } from '@vacp/transport-bridge';
import { createVacpTools } from '../src/vacp-tools';

test('createVacpTransport forwards capabilities + state', async () => {
  const expectedCaps = {
    createdAt: '2026-01-01T00:00:00.000Z',
    version: '1.0.0',
    graph: { nodes: [], edges: [], actions: [] },
  };

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

      return expectedCaps;
    },
    getState: async (options?: unknown) => {
      gotStateOptions = options ?? null;

      return options ? expectedUpdate : expectedState;
    },
    execute: async () => ({ callId: 'unused', ok: true }),
  };

  const transport = createVacpTransport(bridge);
  assert.deepEqual(await transport.vacp_capabilities(), expectedCaps);
  assert.equal(gotCapabilitiesOptions, null);
  const capabilitiesOptions = { prefixes: ['vacp://chart'], includeNodeData: false };
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

test('createVacpTransport execute uses dispatch and preserves MCP-style envelope', async () => {
  const events: Array<{ type: string; payload?: unknown }> = [];

  const bridge = {
    getCapabilities: async () => ({ createdAt: '', version: '1.0.0', graph: { nodes: [], edges: [], actions: [] } }),
    getState: async () => ({ createdAt: '', version: '1.0.0', state: {} }),
    getRuntime: async () => ({ mode: 'inspect' }),
    setMode: (mode: string, context: unknown) => {
      events.push({ type: 'setMode', payload: { mode, context } });
    },
    dispatch: async (call: unknown, meta: unknown) => {
      events.push({ type: 'dispatch', payload: { call, meta } });

      return { callId: 'call-42', ok: true, result: { accepted: true } };
    },
    execute: async () => ({ callId: 'call-should-not-run', ok: true }),
  };

  const transport = createVacpTransport(bridge);
  const result = await transport.vacp_execute('vacp.some_action', { x: 1 }, 'call-42');

  assert.deepEqual(result, { callId: 'call-42', ok: true, result: { accepted: true } });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, 'dispatch');
  assert.deepEqual((events[0]?.payload as any)?.call, {
    callId: 'call-42',
    name: 'vacp.some_action',
    params: { x: 1 },
  });
});

test('createVacpTransport retries empty capabilities/state after refresh', async () => {
  let capabilityCalls = 0;
  let stateCalls = 0;
  let refreshCalls = 0;

  const bridge = {
    getCapabilities: async () => {
      capabilityCalls += 1;

      if (capabilityCalls === 1) {
        return { createdAt: '', version: '1.0.0', graph: { nodes: [], edges: [], actions: [] } };
      }

      return {
        createdAt: '',
        version: '1.0.0',
        graph: { nodes: [{ ref: 'vacp://view' }], edges: [], actions: [{ name: 'x', description: 'x' }] },
      };
    },
    getState: async () => {
      stateCalls += 1;

      if (stateCalls === 1) {
        return { createdAt: '', version: '1.0.0', state: {} };
      }

      return { createdAt: '', version: '1.0.0', state: { 'vacp://view': { ready: true } } };
    },
    refresh: async () => {
      refreshCalls += 1;

      return { createdAt: '', version: '1.0.0', state: { 'vacp://view': { ready: true } } };
    },
    execute: async () => ({ callId: 'unused', ok: true }),
  };

  const transport = createVacpTransport(bridge);
  const caps = await transport.vacp_capabilities();
  const state = await transport.vacp_state();

  assert.equal(refreshCalls >= 2, true);
  assert.equal(caps.graph.nodes.length, 1);
  assert.equal(caps.graph.actions.length, 1);
  assert.deepEqual(state.state, { 'vacp://view': { ready: true } });
});

test('createVacpTools exposes MCP-compatible names and forwards inputs', async () => {
  const calls: Array<{ tool: string; args: unknown[] }> = [];

  const transport = {
    vacp_capabilities: async (options?: unknown) => {
      calls.push({ tool: 'vacp_capabilities', args: [options] });

      return { ok: true };
    },
    vacp_state: async (options?: unknown) => {
      calls.push({ tool: 'vacp_state', args: [options] });

      return { ok: true, options };
    },
    vacp_execute: async (name: string, params?: unknown, callId?: string) => {
      calls.push({ tool: 'vacp_execute', args: [name, params, callId] });

      return { callId: callId ?? 'generated', ok: true };
    },
  };

  const tools = createVacpTools({ transport: transport });
  assert.deepEqual(Object.keys(tools).sort(), ['vacp_capabilities', 'vacp_execute', 'vacp_state']);

  const caps = await tools.vacp_capabilities.execute({ prefixes: ['vacp://chart'] });
  assert.deepEqual(caps, { ok: true });

  const state = await tools.vacp_state.execute({
    mode: 'full',
    refs: ['vacp://chart/a'],
    includeSummary: true,
  });

  assert.deepEqual(state, { ok: true, options: { mode: 'full', refs: ['vacp://chart/a'], includeSummary: true } });

  const exec = await tools.vacp_execute.execute({
    name: 'vacp.data_sql',
    params: { sql: 'select 1' },
    call_id: 'call-99',
  });

  assert.deepEqual(exec, { callId: 'call-99', ok: true });

  assert.deepEqual(calls, [
    { tool: 'vacp_capabilities', args: [{ prefixes: ['vacp://chart'] }] },
    { tool: 'vacp_state', args: [{ mode: 'full', refs: ['vacp://chart/a'], includeSummary: true }] },
    { tool: 'vacp_execute', args: ['vacp.data_sql', { sql: 'select 1' }, 'call-99'] },
  ]);
});

test('createVacpTools normalizes bare root scopes and logs effective inputs', async () => {
  const calls: Array<{ tool: string; args: unknown[] }> = [];
  const events: any[] = [];

  const transport = {
    vacp_capabilities: async (options?: unknown) => {
      calls.push({ tool: 'vacp_capabilities', args: [options] });

      return { ok: true };
    },
    vacp_state: async (options?: unknown) => {
      calls.push({ tool: 'vacp_state', args: [options] });

      return { ok: true };
    },
    vacp_execute: async () => ({ callId: 'unused', ok: true }),
  };

  const tools = createVacpTools({
    transport: transport,
    onToolEvent: (event) => events.push(event),
  });

  await tools.vacp_capabilities.execute({
    refs: ['vacp://'],
    includeActions: true,
    includeNodeData: true,
  });
  await tools.vacp_state.execute({
    mode: 'full',
    refs: ['vacp://'],
    includeSummary: true,
  });

  assert.deepEqual(calls, [
    {
      tool: 'vacp_capabilities',
      args: [{ includeActions: true, includeNodeData: false }],
    },
    {
      tool: 'vacp_state',
      args: [{ mode: 'full', includeSummary: true }],
    },
  ]);

  const capabilityStart = events.find((event) => event.toolName === 'vacp_capabilities' && event.status === 'started');
  const stateStart = events.find((event) => event.toolName === 'vacp_state' && event.status === 'started');

  assert.deepEqual(capabilityStart?.requestedInput, {
    refs: ['vacp://'],
    includeActions: true,
    includeNodeData: true,
  });
  assert.deepEqual(capabilityStart?.input, {
    includeActions: true,
    includeNodeData: false,
  });
  assert.match(capabilityStart?.inputNote ?? '', /bare `vacp:\/\/` scope/i);
  assert.match(capabilityStart?.inputNote ?? '', /includeNodeData/i);

  assert.deepEqual(stateStart?.requestedInput, {
    mode: 'full',
    refs: ['vacp://'],
    includeSummary: true,
  });
  assert.deepEqual(stateStart?.input, {
    mode: 'full',
    includeSummary: true,
  });
  assert.match(stateStart?.inputNote ?? '', /bare `vacp:\/\/` scope/i);
});
