import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { VACP_SCHEMA_VERSION, type VacpActionRequest } from '../../src/protocol';
import { createVacpToolHandlers, type VacpToolBridge } from '../../src/bridge/index';

const callIds: { assigned: Array<{ callId?: string | null }>; kept: Array<{ callId: string }> } = JSON.parse(
  readFileSync(new URL('../protocol/fixtures/call-id.json', import.meta.url), 'utf8'),
);
const graph = { sources: [], nodes: [], edges: [], actions: [] };
const ownership = { nodes: {}, actions: {} };

/**
 * A bridge that answers every read with `extra` beside its fields and records what each call received. Like
 * the runtime, it numbers a call that arrives without a call ID.
 */
function bridge(extra: Record<string, unknown> = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  let assigned = 0;
  const page: VacpToolBridge = {
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
      return { callId: call.callId ?? `runtime-${++assigned}`, ok: true, result: extra.note ?? call.params };
    },
    narrate: (input) => {
      calls.push(['narrate', input]);
    },
  };
  return { bridge: page, calls };
}

test('graph reads reach the agent without source ownership', async () => {
  const tools = createVacpToolHandlers(bridge().bridge);
  assert.deepEqual(await tools.vacp_observe(), {
    version: VACP_SCHEMA_VERSION,
    revision: 'r',
    observedAt: '',
    graph,
    state: {},
  });
  assert.deepEqual(await tools.vacp_capabilities(), { version: VACP_SCHEMA_VERSION, createdAt: '', graph });
});

test('a bare vacp:// scope reads everything, and every state read asks for a token', async () => {
  const { bridge: page, calls } = bridge();
  const tools = createVacpToolHandlers(page);
  await tools.vacp_capabilities({ refs: ['vacp://'] });
  await tools.vacp_capabilities({ prefixes: ['vacp://', 'vacp://chart/'], includeNodeData: true });
  await tools.vacp_state();
  await tools.vacp_state({ refs: ['vacp://'] });
  await tools.vacp_state({ since: 'st_1', refs: ['vacp://chart/a'], includeSummary: false });
  assert.deepEqual(calls, [
    ['capabilities', { includeNodeData: false }],
    ['capabilities', { prefixes: ['vacp://chart/'], includeNodeData: true }],
    ['state', {}],
    ['state', {}],
    ['state', { since: 'st_1', refs: ['vacp://chart/a'], includeSummary: false }],
  ]);
});

test('execution carries the step’s sentence, the handlers’ actor, and the caller’s signal', async () => {
  const { bridge: page, calls } = bridge();
  const actor = { id: 'analyst', kind: 'agent' as const, label: 'Analyst' };
  const tools = createVacpToolHandlers(page, { actor });
  const controller = new AbortController();
  assert.deepEqual(
    await tools.vacp_execute(
      { name: ' set ', params: { value: 2 }, narration: ' Raising the threshold. ', callId: 'c1' },
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
  await assert.rejects(tools.vacp_execute({ name: 'set', narration: '  ' }), /requires a sentence/);
  await assert.rejects(tools.vacp_execute({ name: ' ', narration: 'Setting.' }), /non-empty action name/);
  assert.equal(calls.length, 1);
});

test('a step passes its call ID to the runtime as written and answers with the runtime’s', async () => {
  const { bridge: page, calls } = bridge();
  const tools = createVacpToolHandlers(page);
  assert.deepEqual(await tools.vacp_execute({ name: 'set', params: 1, narration: 'Setting it to 1.' }), {
    callId: 'runtime-1',
    ok: true,
    result: 1,
  });
  const supplied = [...callIds.assigned, ...callIds.kept].map(({ callId }) => callId);
  for (const callId of supplied) await tools.vacp_execute({ name: 'set', narration: 'Setting it.', callId });
  assert.deepEqual(
    calls.map(([, call]) => (call as VacpActionRequest).callId),
    [undefined, ...supplied],
  );
});

test('progress speaks through the bridge narrator as the default agent', async () => {
  const { bridge: page, calls } = bridge();
  const tools = createVacpToolHandlers(page);
  assert.deepEqual(await tools.vacp_progress({ message: ' Looking at the age spread. ' }), { ok: true });
  assert.deepEqual(await tools.vacp_progress({ message: 'Most are 22 to 28.', done: true }), { ok: true });
  await assert.rejects(tools.vacp_progress({ message: '' }), /requires a sentence/);
  const actor = { id: 'agent', kind: 'agent' };
  assert.deepEqual(calls, [
    ['narrate', { actor, message: 'Looking at the age spread.', done: false, signal: undefined }],
    ['narrate', { actor, message: 'Most are 22 to 28.', done: true, signal: undefined }],
  ]);
});

test('a step the agent cancels reaches the action handler through its signal', async () => {
  let cancelled: unknown;
  const page: VacpToolBridge = {
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
  const running = createVacpToolHandlers(page).vacp_execute({ name: 'slow', narration: 'Waiting.' }, controller.signal);
  controller.abort(new Error('stopped'));
  await assert.rejects(running, /stopped/);
  assert.match(String(cancelled), /stopped/);
});

test('every answer reaches the model cut to the limits every transport shares', async () => {
  const note = 'x'.repeat(12_001);
  const cut = `${'x'.repeat(11_976)}... [25 more characters]`;
  const tools = createVacpToolHandlers(bridge({ note }).bridge);
  const reads = [
    await tools.vacp_observe(),
    await tools.vacp_capabilities(),
    await tools.vacp_state(),
    await tools.vacp_execute({ name: 'set', narration: 'Setting.', callId: 'c1' }),
  ] as Array<{ note?: string; result?: string }>;
  assert.deepEqual(
    reads.map((read) => read.note ?? read.result),
    [cut, cut, cut, cut],
  );
});
