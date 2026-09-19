import assert from 'node:assert/strict';
import test from 'node:test';
import { VACP_SCHEMA_VERSION, type VacpProvider } from '@vacp/protocol';
import { createVacpRuntime, createVacpProvider, composeVacpProviders, VacpActionRegistry } from '../src/index';

test('cross-source readiness governs discovery, subscriptions, stale calls and post-pacing execution', async () => {
  let ready = false,
    mutations = 0,
    prepared = 0;
  const dataset: VacpProvider = {
    source: { id: 'vacp-source://data', type: 'data', title: 'Dataset' },
    observe: () => ({
      revision: String(ready),
      observedAt: '',
      graph: {
        version: VACP_SCHEMA_VERSION,
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
    source: { id: 'vacp-source://chart', type: 'chart', title: 'Chart' },
    actions,
    project: () => ({
      graph: {
        version: VACP_SCHEMA_VERSION,
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
    assert.equal((await composition.execute({ callId: 'blocked-composition', name: 'click' })).ok, false);
    assert.equal(prepared, 0);
  } finally {
    composition.dispose({ providers: false });
  }
  const runtime = createVacpRuntime({ providers: [dataset, chart] });
  const catalogs: string[][] = [];
  runtime.subscribeCapabilities((snapshot) => catalogs.push(snapshot.graph.actions.map((action) => action.name)));
  runtime.stopObserving();
  try {
    assert.deepEqual((await runtime.observe()).graph.actions, []);
    assert.deepEqual((await runtime.getState()).state, {});
    const complete = await runtime.inspect();
    assert.deepEqual(
      complete.graph.actions.map((action) => action.name),
      ['click'],
    );
    assert.equal((await runtime.execute({ callId: 'blocked', name: 'click' })).ok, false);
    assert.equal(prepared, 0);
    ready = true;
    assert.equal((await runtime.observe()).graph.actions.length, 1);
    const baseline = await runtime.getState({ mode: 'full' });
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
    const delta = await runtime.getState({ mode: 'delta', since: baseline.token });
    assert.equal(delta.mode, 'delta');
    if (delta.mode === 'delta') assert.deepEqual(delta.delta.removed.sort(), ['vacp://bar', 'vacp://data']);
    assert.deepEqual(catalogs, [[], ['click'], []]);
  } finally {
    runtime.dispose();
  }
});

test('composition guards its owned invocation after asynchronous preparation', async () => {
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
    source: { id: 'vacp-source://data', type: 'data', title: 'Data' },
    actions,
    project: () => ({
      graph: {
        version: VACP_SCHEMA_VERSION,
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
  const composition = composeVacpProviders([provider]);
  try {
    const call = { callId: 'owned', name: 'query', params: { ref: 'vacp://original' } };
    const executing = composition.execute(call);
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
    composition.dispose();
  }
});

test('composition rechecks cancellation after its final observation', async () => {
  const abort = new AbortController();
  let prepared = false;
  let mutations = 0;
  const provider: VacpProvider = {
    source: { id: 'vacp-source://chart', type: 'chart', title: 'Chart' },
    observe: () => {
      if (prepared) abort.abort();
      return {
        revision: '1',
        observedAt: '',
        state: {},
        graph: {
          version: VACP_SCHEMA_VERSION,
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
  const composition = composeVacpProviders([provider]);
  try {
    await assert.rejects(composition.execute({ callId: 'cancelled', name: 'run' }, { signal: abort.signal }), {
      name: 'AbortError',
    });
    assert.equal(mutations, 0);
  } finally {
    composition.dispose();
  }
});
