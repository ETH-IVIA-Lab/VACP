import assert from 'node:assert/strict';
import test from 'node:test';
import type { VacpProvider } from '@vacp/protocol';
import { createVacpRuntime, createVacpProvider, composeVacpProviders, VacpActionRegistry } from '../src/index';

test('cross-source readiness governs discovery, subscriptions, stale calls and post-pacing execution', async () => {
  let ready = false,
    mutations = 0,
    prepared = 0;
  const dataset: VacpProvider = {
    subscribe: () => () => {},
    source: { id: 'vacp-source://data', type: 'data', title: 'Dataset' },
    observe: () => ({
      revision: String(ready),
      observedAt: '',
      graph: {
        nodes: [
          {
            ref: 'vacp://data',
            kind: 'DataHandle',
            layer: 'DataLayer',
            availability: ready ? undefined : { unavailable: 'Select dataset' },
          },
        ],
        edges: [],
        actions: [],
      },
      state: { 'vacp://data': ready },
    }),
    prepare: async () => {
      throw new Error('No data operation');
    },
  };
  const actions = new VacpActionRegistry();
  actions.register(
    {
      name: 'click',
      description: 'Click bar',
      availability: { requires: ['vacp://bar'] },
      operation: { kind: 'mutation' },
    },
    () => {
      mutations++;
    },
    {
      parse: () => {
        prepared++;
      },
    },
  );
  const chart = createVacpProvider({
    subscribe: () => () => {},
    source: { id: 'vacp-source://chart', type: 'chart', title: 'Chart' },
    actions,
    project: () => ({
      graph: {
        nodes: [
          { ref: 'vacp://bar', kind: 'Mark', layer: 'VisualizationLayer', availability: { requires: ['vacp://data'] } },
        ],
        edges: [],
        actions: actions.list(),
      },
      state: { 'vacp://bar': { value: 12 } },
    }),
  });
  const composition = composeVacpProviders([dataset, chart]);
  try {
    const { inspection, observation } = await composition.read();
    assert.deepEqual(
      inspection.graph.actions.map((action) => action.name),
      ['click'],
    );
    assert.deepEqual(observation.graph.actions, []);
  } finally {
    composition.dispose({ providers: false });
  }
  const runtime = createVacpRuntime({ providers: [dataset, chart] });
  const catalogs: string[][] = [];
  runtime.subscribeCapabilities((snapshot) => catalogs.push(snapshot.graph.actions.map((action) => action.name)));
  try {
    assert.deepEqual((await runtime.observe()).graph.actions, []);
    const hidden = await runtime.getState();
    assert.deepEqual(hidden.mode === 'full' && hidden.snapshot.state, {});
    const complete = await runtime.inspect();
    assert.deepEqual(
      complete.graph.actions.map((action) => action.name),
      ['click'],
    );
    assert.equal((await runtime.execute({ callId: 'blocked', name: 'click' })).ok, false);
    assert.equal(prepared, 0);
    ready = true;
    assert.equal((await runtime.observe()).graph.actions.length, 1);
    const baseline = await runtime.getState();
    assert.equal((await runtime.execute({ callId: 'ready', name: 'click' })).ok, true);
    assert.equal(mutations, 1);
    runtime.addExecutionGate(
      () => {
        ready = false;
      },
      { timeoutMs: 1000 },
    );
    assert.equal((await runtime.execute({ callId: 'changed-during-pacing', name: 'click' })).ok, false);
    assert.equal(mutations, 1);
    const delta = await runtime.getState({ since: baseline.token });
    assert.equal(delta.mode, 'delta');
    if (delta.mode === 'delta') assert.deepEqual(delta.delta.removed.sort(), ['vacp://bar', 'vacp://data']);
    assert.deepEqual(catalogs, [[], ['click'], []]);
  } finally {
    runtime.dispose();
  }
});

test('the runtime guards an invocation again after asynchronous preparation', async () => {
  let available = true;
  let mutations = 0;
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const preparing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const actions = new VacpActionRegistry();
  actions.register(
    {
      name: 'query',
      description: 'Query data',
      operation: { kind: 'query', refParameters: [{ parameter: 'ref', role: 'input' }] },
    },
    (ref) => {
      mutations++;
      return ref;
    },
    {
      parse: async (input) => {
        assert.ok(input && typeof input === 'object' && 'ref' in input);
        const ref = input.ref;
        entered();
        await waiting;
        return ref;
      },
    },
  );
  const provider = createVacpProvider({
    subscribe: () => () => {},
    source: { id: 'vacp-source://data', type: 'data', title: 'Data' },
    actions,
    project: () => ({
      graph: {
        edges: [],
        actions: actions.list(),
        nodes: [
          {
            ref: 'vacp://original',
            kind: 'Data',
            layer: 'DataLayer',
            availability: available ? undefined : { unavailable: 'Closed' },
          },
          { ref: 'vacp://other', kind: 'Data', layer: 'DataLayer' },
        ],
      },
      state: {},
    }),
  });
  const runtime = createVacpRuntime({ providers: [provider] });
  try {
    const call = { callId: 'owned', name: 'query', params: { ref: 'vacp://original' } };
    const executing = runtime.execute(call);
    await preparing;
    available = false;
    call.params.ref = 'vacp://other';
    release();
    const result = await executing;
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.deepEqual(result.error.details, {
        code: 'input-unavailable',
        action: 'query',
        ref: 'vacp://original',
        status: { available: false, blockedBy: [], reason: 'Closed' },
      });
    assert.equal(mutations, 0);
  } finally {
    release();
    runtime.dispose();
  }
});

test('the runtime rechecks cancellation after its final observation', async () => {
  const abort = new AbortController();
  let prepared = false;
  let mutations = 0;
  const provider: VacpProvider = {
    subscribe: () => () => {},
    source: { id: 'vacp-source://chart', type: 'chart', title: 'Chart' },
    observe: () => {
      if (prepared) abort.abort();
      return {
        revision: '1',
        observedAt: '',
        state: {},
        graph: {
          nodes: [],
          edges: [],
          actions: [{ name: 'run', description: 'Run', operation: { kind: 'mutation' } }],
        },
      };
    },
    prepare: async (call) => {
      prepared = true;
      return {
        intent: { affects: [] },
        execute: async () => {
          mutations++;
          return { callId: call.callId, ok: true };
        },
      };
    },
  };
  const runtime = createVacpRuntime({ providers: [provider] });
  try {
    await assert.rejects(runtime.execute({ callId: 'cancelled', name: 'run' }, { signal: abort.signal }), {
      name: 'AbortError',
    });
    assert.equal(mutations, 0);
  } finally {
    runtime.dispose();
  }
});
