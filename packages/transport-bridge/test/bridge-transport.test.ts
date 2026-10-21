import assert from 'node:assert/strict';
import test from 'node:test';

import { VACP_SCHEMA_VERSION } from '@ethivia/vacp-protocol';
import { createVacpTransport, type VacpTransportBridge } from '../src/index';

const graph = { sources: [], nodes: [], edges: [], actions: [] };
const ownership = { nodes: {}, actions: {} };

/** A bridge that answers every read with `extra` beside its fields and records what each call received. */
function bridge(extra: Record<string, unknown> = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const page: VacpTransportBridge = {
    version: VACP_SCHEMA_VERSION,
    observe: async () => {
      calls.push(['observe']);
      const read = {
        version: VACP_SCHEMA_VERSION,
        revision: 'r',
        observedAt: '',
        graph: { ...graph, ownership },
        state: {},
        ...extra,
      };
      return read;
    },
    getCapabilities: async (request) => {
      calls.push(['capabilities', request]);
      const read = { version: VACP_SCHEMA_VERSION, createdAt: '', graph: { ...graph, ownership }, ...extra };
      return read;
    },
    getState: async (request) => {
      calls.push(['state', request]);
      const snapshot = { version: VACP_SCHEMA_VERSION, createdAt: '', state: {} };
      const read = {
        version: VACP_SCHEMA_VERSION,
        createdAt: '',
        mode: 'full' as const,
        token: 'st_1',
        snapshot,
        ...extra,
      };
      return read;
    },
    execute: async (call, options) => {
      calls.push(['execute', call, options]);
      return { callId: call.callId, ok: true, result: extra.note ?? call.params };
    },
    narrate: (input) => {
      calls.push(['narrate', input]);
    },
  };
  return { bridge: page, calls };
}

test('graph reads reach the agent without source ownership', async () => {
  const transport = createVacpTransport(bridge().bridge);
  assert.deepEqual(await transport.vacp_observe(), {
    version: VACP_SCHEMA_VERSION,
    revision: 'r',
    observedAt: '',
    graph,
    state: {},
  });
  assert.deepEqual(await transport.vacp_capabilities(), { version: VACP_SCHEMA_VERSION, createdAt: '', graph });
});

test('a bare vacp:// scope reads everything, and every state read asks for a token', async () => {
  const { bridge: page, calls } = bridge();
  const transport = createVacpTransport(page);
  await transport.vacp_capabilities({ refs: ['vacp://'] });
  await transport.vacp_capabilities({ prefixes: ['vacp://', 'vacp://chart/'], includeNodeData: true });
  await transport.vacp_state();
  await transport.vacp_state({ refs: ['vacp://'] });
  await transport.vacp_state({ since: 'st_1', refs: ['vacp://chart/a'], includeSummary: false });
  assert.deepEqual(calls, [
    ['capabilities', { includeNodeData: false }],
    ['capabilities', { prefixes: ['vacp://chart/'], includeNodeData: true }],
    ['state', {}],
    ['state', {}],
    ['state', { since: 'st_1', refs: ['vacp://chart/a'], includeSummary: false }],
  ]);
});

test('execution carries the step’s sentence, the transport’s actor, and the caller’s signal', async () => {
  const { bridge: page, calls } = bridge();
  const actor = { id: 'analyst', kind: 'agent' as const, label: 'Analyst' };
  const transport = createVacpTransport(page, { actor });
  const controller = new AbortController();
  assert.deepEqual(
    await transport.vacp_execute(
      { name: ' set ', params: { value: 2 }, narration: ' Raising the threshold. ', call_id: 'c1' },
      controller.signal,
    ),
    { callId: 'c1', ok: true, result: { value: 2 } },
  );
  assert.deepEqual(calls, [
    [
      'execute',
      { callId: 'c1', name: 'set', params: { value: 2 } },
      { actor, narration: 'Raising the threshold.', signal: controller.signal },
    ],
  ]);
  await assert.rejects(transport.vacp_execute({ name: 'set', narration: '  ' }), /requires a sentence/);
  await assert.rejects(transport.vacp_execute({ name: ' ', narration: 'Setting.' }), /non-empty action name/);
  assert.equal(calls.length, 1);
});

test('progress speaks through the bridge narrator as the default agent', async () => {
  const { bridge: page, calls } = bridge();
  const transport = createVacpTransport(page);
  assert.deepEqual(await transport.vacp_progress({ message: ' Looking at the age spread. ' }), { ok: true });
  assert.deepEqual(await transport.vacp_progress({ message: 'Most are 22 to 28.', done: true }), { ok: true });
  await assert.rejects(transport.vacp_progress({ message: '' }), /requires a sentence/);
  const actor = { id: 'agent', kind: 'agent' };
  assert.deepEqual(calls, [
    ['narrate', { actor, message: 'Looking at the age spread.', done: false, signal: undefined }],
    ['narrate', { actor, message: 'Most are 22 to 28.', done: true, signal: undefined }],
  ]);
});

test('a step the agent cancels reaches the action handler through its signal', async () => {
  let cancelled: unknown;
  const page: VacpTransportBridge = {
    ...bridge().bridge,
    execute: (_call, options) =>
      new Promise<never>((_, reject) => {
        options?.signal?.addEventListener('abort', () => {
          cancelled = options.signal?.reason;
          reject(options.signal?.reason);
        });
      }),
  };
  const controller = new AbortController();
  const running = createVacpTransport(page).vacp_execute({ name: 'slow', narration: 'Waiting.' }, controller.signal);
  controller.abort(new Error('stopped'));
  await assert.rejects(running, /stopped/);
  assert.match(String(cancelled), /stopped/);
});

test('every answer reaches the model cut to the limits every transport shares', async () => {
  const note = 'x'.repeat(12_001);
  const cut = `${'x'.repeat(11_976)}... [25 more characters]`;
  const transport = createVacpTransport(bridge({ note }).bridge);
  const reads = [
    await transport.vacp_observe(),
    await transport.vacp_capabilities(),
    await transport.vacp_state(),
    await transport.vacp_execute({ name: 'set', narration: 'Setting.', call_id: 'c1' }),
  ] as Array<{ note?: string; result?: string }>;
  assert.deepEqual(
    reads.map((read) => read.note ?? read.result),
    [cut, cut, cut, cut],
  );
});
