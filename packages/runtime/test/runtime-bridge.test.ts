import { z } from 'zod';
import assert from 'node:assert/strict';
import test from 'node:test';

import type { VacpRuntimeSnapshot, VacpStateSnapshot } from '@vacp/protocol';
import { VACP_SCHEMA_VERSION } from '@vacp/protocol';

import {
  createVacpRuntime,
  createVacpProvider,
  registerVacpApplyStateAction,
  VacpActionRegistry,
  type VacpRuntime,
} from '../src/index';

const valueSchema = z.object({ value: z.string() });

const ref = 'vacp://test/input/0';

function stateSnapshot(value: string): VacpStateSnapshot {
  return {
    version: VACP_SCHEMA_VERSION,
    createdAt: '2026-06-10T00:00:00.000Z',
    state: {
      [ref]: { kind: 'Widget', value },
    },
  };
}

function createTestRuntime(actions: VacpActionRegistry, getValue: () => string) {
  const provider = createVacpProvider({
    source: { id: 'vacp-source://runtime-replay', type: 'test', title: 'Replay test' },
    actions,
    project: () => ({
      graph: {
        version: VACP_SCHEMA_VERSION,
        nodes: [{ ref, kind: 'Widget', layer: 'ConfigLayer', title: 'Input' }],
        edges: [],
      },
      state: stateSnapshot(getValue()).state,
    }),
  });
  return createVacpRuntime({ providers: [provider] });
}

function whenLive(runtime: VacpRuntime): Promise<VacpRuntimeSnapshot> {
  return new Promise((resolve, reject) => {
    const unsubscribe = runtime.subscribe((entry) => {
      if (entry.kind !== 'mode') return;
      void runtime.getRuntime().then(
        (snapshot) => {
          if (snapshot.mode !== 'live') return;
          unsubscribe();
          resolve(snapshot);
        },
        (error) => {
          unsubscribe();
          reject(error);
        },
      );
    });
  });
}

test('returning live supersedes a pending historical restoration', { timeout: 10_000 }, async (t) => {
  let hostValue = 'old';
  let releaseOldReplay!: () => void;

  const oldReplayReleased = new Promise<void>((resolve) => {
    releaseOldReplay = resolve;
  });

  let oldReplayStarted!: () => void;

  const oldReplayInFlight = new Promise<void>((resolve) => {
    oldReplayStarted = resolve;
  });

  const actions = new VacpActionRegistry();
  registerVacpApplyStateAction(actions, async (state) => {
    const next = valueSchema.parse(state[ref]).value;

    if (next === 'old') {
      oldReplayStarted();
      await oldReplayReleased;
    }

    hostValue = next;
  });

  const bridge = createTestRuntime(actions, () => hostValue);
  t.after(() => bridge.dispose());

  await bridge.refresh({ source: 'inspector', message: 'old snapshot' });
  hostValue = 'live';
  await bridge.refresh({ source: 'inspector', message: 'live snapshot' });

  bridge.setCursor(0, { source: 'inspector', message: 'inspect old' });
  await oldReplayInFlight;

  const live = whenLive(bridge);
  bridge.setMode('live', { source: 'inspector', message: 'return live while inspect replay is in flight' });
  releaseOldReplay();

  const runtime = await live;
  assert.equal(hostValue, 'live');
  assert.equal(valueSchema.parse(runtime.liveState.state[ref]).value, 'live');
  assert.equal(valueSchema.parse(runtime.currentState.state[ref]).value, 'live');
});

test('returning live restores the last observation even when it was not recorded', { timeout: 10_000 }, async (t) => {
  let hostValue = 'old';
  let restored!: () => void;
  const restoration = new Promise<void>((resolve) => {
    restored = resolve;
  });
  const actions = new VacpActionRegistry();
  registerVacpApplyStateAction(actions, async (state) => {
    const next = valueSchema.parse(state[ref]).value;

    hostValue = next;
    if (next === 'old') restored();
  });

  const bridge = createTestRuntime(actions, () => hostValue);
  t.after(() => bridge.dispose());

  await bridge.refresh({ source: 'inspector', message: 'recorded old snapshot' });
  hostValue = 'live-unrecorded';

  const observed = await bridge.getRuntime();
  assert.equal(valueSchema.parse(observed.liveState.state[ref]).value, 'live-unrecorded');
  assert.deepEqual(
    observed.history.map((entry) =>
      entry.kind === 'snapshot' ? valueSchema.parse(entry.state?.state[ref]).value : undefined,
    ),
    ['old'],
  );

  bridge.setCursor(0, { source: 'inspector', message: 'inspect recorded old' });
  await restoration;

  const live = whenLive(bridge);
  bridge.setMode('live', { source: 'inspector', message: 'return to unrecorded live state' });
  const runtime = await live;
  assert.equal(hostValue, 'live-unrecorded');
  assert.equal(valueSchema.parse(runtime.liveState.state[ref]).value, 'live-unrecorded');
  assert.equal(valueSchema.parse(runtime.currentState.state[ref]).value, 'live-unrecorded');
});

test('composed sources restore their own state through shared semantic contracts', { timeout: 10_000 }, async (t) => {
  const values = { first: 'old-first', second: 'old-second' };
  const received: Record<string, string[][]> = { first: [], second: [] };
  const providers = (['first', 'second'] as const).map((name) => {
    const sourceId = `vacp-source://replay/${name}` as const;
    const nodeRef = `vacp://replay/${name}` as const;
    const actions = new VacpActionRegistry(sourceId);
    registerVacpApplyStateAction(
      actions,
      (state) => {
        received[name]!.push(Object.keys(state));
        values[name] = valueSchema.parse(state[nodeRef]).value;
      },
      { affects: [nodeRef] },
    );
    return createVacpProvider({
      source: { id: sourceId, type: 'test', title: name },
      actions,
      project: () => ({
        graph: {
          version: VACP_SCHEMA_VERSION,
          nodes: [{ ref: nodeRef, kind: 'Widget', layer: 'ConfigLayer' }],
          edges: [],
        },
        state: { [nodeRef]: { value: values[name] } },
      }),
    });
  });
  const runtime = createVacpRuntime({ providers });
  t.after(() => runtime.dispose());
  await runtime.refresh();
  const observation = await runtime.observe();
  assert.equal(new Set(observation.graph.actions.map((action) => action.name)).size, 2);
  assert.deepEqual(
    observation.graph.actions.map((action) => action.operation.contract),
    ['vacp.apply_state', 'vacp.apply_state'],
  );
  values.first = 'live-first';
  values.second = 'live-second';
  await runtime.refresh();
  const restored = new Promise<void>((resolve) => {
    const unsubscribe = runtime.subscribeSnapshots(({ state }) => {
      if (
        valueSchema.parse(state.state['vacp://replay/first']).value !== 'old-first' ||
        valueSchema.parse(state.state['vacp://replay/second']).value !== 'old-second'
      )
        return;
      unsubscribe();
      resolve();
    });
  });
  runtime.setCursor(0);
  await restored;
  assert.deepEqual(received, { first: [['vacp://replay/first']], second: [['vacp://replay/second']] });
  const live = whenLive(runtime);
  runtime.setMode('live');
  await live;
  assert.deepEqual(values, { first: 'live-first', second: 'live-second' });
});

test('ambiguous restoration contracts fail before invoking any handler', { timeout: 10_000 }, async (t) => {
  let mutations = 0;
  const actions = new VacpActionRegistry();
  registerVacpApplyStateAction(actions, () => {
    mutations++;
  });
  actions.register(
    {
      name: 'alternate.restore',
      description: 'Alternative state restoration',
      operation: { kind: 'mutation', contract: 'vacp.apply_state' },
    },
    () => {
      mutations++;
    },
  );
  const runtime = createTestRuntime(actions, () => 'unchanged');
  t.after(() => runtime.dispose());
  let report!: (message: string) => void;
  const failed = new Promise<string>((resolve) => {
    report = resolve;
  });
  runtime.subscribe((entry) => {
    if (entry.message?.startsWith('inspect replay failed')) report(entry.message);
  });
  await runtime.refresh();
  runtime.setCursor(0);
  assert.match(await failed, /multiple state restorers.*vacp.apply_state.*alternate.restore/);
  assert.equal(mutations, 0);
  assert.equal(valueSchema.parse((await runtime.observe()).state[ref]).value, 'unchanged');
});

test(
  'failed restoration waits for every source and observes partial state before the next replay',
  { timeout: 10_000 },
  async (t) => {
    const values = { first: 'old', second: 'old' };
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const restoring = new Promise<void>((resolve) => {
      started = resolve;
    });
    const calls: string[] = [];
    let restoringSecond = false;
    let overlappingReplay = false;
    const providers = (['first', 'second'] as const).map((name) => {
      const sourceId = `vacp-source://partial/${name}` as const;
      const nodeRef = `vacp://partial/${name}` as const;
      const actions = new VacpActionRegistry(sourceId);
      registerVacpApplyStateAction(actions, async (state) => {
        const next = valueSchema.parse(state[nodeRef]).value;
        calls.push(`${name}:${next}`);
        if (next === 'live' && restoringSecond) overlappingReplay = true;
        if (next === 'old' && name === 'first') throw new Error('Cannot restore first');
        if (next === 'old' && name === 'second') {
          restoringSecond = true;
          started();
          await blocked;
          restoringSecond = false;
        }
        values[name] = next;
      });
      return createVacpProvider({
        source: { id: sourceId, type: 'test', title: name },
        actions,
        project: () => ({
          graph: {
            version: VACP_SCHEMA_VERSION,
            nodes: [{ ref: nodeRef, kind: 'Widget', layer: 'ConfigLayer' }],
            edges: [],
          },
          state: { [nodeRef]: { value: values[name] } },
        }),
      });
    });
    const runtime = createVacpRuntime({ providers });
    t.after(() => {
      release();
      runtime.dispose();
    });
    const observations: VacpStateSnapshot['state'][] = [];
    runtime.subscribeSnapshots(({ observation }) => observations.push(observation.state));
    await runtime.refresh();
    values.first = 'live';
    values.second = 'live';
    await runtime.refresh();
    runtime.setCursor(0);
    await restoring;
    assert.deepEqual([...calls].sort(), ['first:old', 'second:old']);
    const live = whenLive(runtime);
    runtime.setMode('live');
    // Let ready continuations run while the second source remains explicitly blocked.
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(overlappingReplay, false);
    release();
    await live;
    assert.deepEqual(
      observations.find(
        (state) =>
          valueSchema.parse(state['vacp://partial/first']).value === 'live' &&
          valueSchema.parse(state['vacp://partial/second']).value === 'old',
      ),
      { 'vacp://partial/first': { value: 'live' }, 'vacp://partial/second': { value: 'old' } },
    );
    assert.deepEqual(values, { first: 'live', second: 'live' });
    assert.deepEqual([...calls].sort(), ['first:live', 'first:old', 'second:live', 'second:old']);
  },
);
