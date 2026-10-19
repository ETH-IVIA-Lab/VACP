import assert from 'node:assert/strict';
import test from 'node:test';

import type { VacpRef } from '@ethivia/vacp-protocol';

import { createVacpProvider, createVacpRuntime, VacpActionRegistry } from '../src/index';

const viewRef = 'vacp://test-app/example-view';
const teamRef = `${viewRef}/input/0` as const;
const athleteRef = `${viewRef}/input/1` as const;
const dataRef = `${viewRef}/data/main` as const;
const auxiliaryRef = `${viewRef}/data/auxiliary` as const;
const otherRef = 'vacp://other/view/input/0' as const;

/** A runtime over one source whose state and summary the test replaces between reads. */
function source(initial: { state: Record<VacpRef, unknown>; summary?: Record<VacpRef, unknown> }) {
  let current = initial;
  let invalidate = () => {};
  const refs: VacpRef[] = [teamRef, athleteRef, dataRef, auxiliaryRef, otherRef];
  const runtime = createVacpRuntime({
    providers: [
      createVacpProvider({
        source: { id: 'vacp-source://state', type: 'test', title: 'State' },
        actions: new VacpActionRegistry(),
        project: () => ({
          graph: { nodes: refs.map((ref) => ({ ref, kind: 'Widget', layer: 'ConfigLayer' })), edges: [], actions: [] },
          state: current.state,
          summary: current.summary,
        }),
        subscribe: (listener) => {
          invalidate = listener;
          return () => {};
        },
      }),
    ],
  });
  return {
    runtime,
    set(this: void, next: typeof current) {
      current = next;
      invalidate();
    },
  };
}

test('a read without since returns the full scoped state with a token', async (t) => {
  const { runtime } = source({
    state: {
      [teamRef]: { value: '' },
      [athleteRef]: { value: '' },
      [dataRef]: { selectionWhere: null },
      [otherRef]: { value: 'other' },
    },
    summary: { [athleteRef]: { label: 'Athlete' }, [otherRef]: { label: 'Other' } },
  });
  t.after(() => runtime.dispose());
  const unscoped = await runtime.getState();
  assert.equal(unscoped.mode, 'full');
  assert.match(unscoped.token, /^st_/);
  const scoped = await runtime.getState({ refs: [viewRef] });
  assert.equal(scoped.mode, 'full');
  if (scoped.mode !== 'full') return;
  assert.deepEqual(scoped.scope, { refs: [viewRef] });
  assert.deepEqual(scoped.snapshot.state, {
    [teamRef]: { value: '' },
    [athleteRef]: { value: '' },
    [dataRef]: { selectionWhere: null },
  });
  assert.deepEqual(scoped.snapshot.summary, { [athleteRef]: { label: 'Athlete' } });
  assert.notEqual(scoped.token, unscoped.token);
});

test('an unknown token reads the full state', async (t) => {
  const { runtime } = source({ state: { [teamRef]: 'A' } });
  t.after(() => runtime.dispose());
  const update = await runtime.getState({ since: 'st_unknown' });
  assert.equal(update.mode, 'full');
});

test('a narrower read rescopes a broader baseline before computing its delta', async (t) => {
  const { runtime, set } = source({
    state: {
      [teamRef]: { value: '' },
      [athleteRef]: { value: '' },
      [dataRef]: { selectionWhere: null },
      [auxiliaryRef]: { table: 'auxiliary' },
    },
  });
  t.after(() => runtime.dispose());
  const baseline = await runtime.getState();
  set({
    state: {
      [teamRef]: { value: '' },
      [athleteRef]: { value: 'Example Item' },
      [dataRef]: { selectionWhere: `category = 'Example Item'` },
      [auxiliaryRef]: { table: 'changed' },
    },
  });
  const update = await runtime.getState({ since: baseline.token, refs: [teamRef, athleteRef, dataRef] });
  assert.equal(update.mode, 'delta');
  if (update.mode !== 'delta') return;
  assert.deepEqual(update.scope, { refs: [dataRef, teamRef, athleteRef] });
  assert.deepEqual(update.delta, {
    changed: {
      [athleteRef]: { value: 'Example Item' },
      [dataRef]: { selectionWhere: `category = 'Example Item'` },
    },
    removed: [],
    summaryChanged: undefined,
    summaryRemoved: undefined,
  });
});

test('an unchanged read is an empty delta while a changed summary stays observable', async (t) => {
  const { runtime, set } = source({ state: { [teamRef]: { value: 'A' } }, summary: { [teamRef]: { count: 3 } } });
  t.after(() => runtime.dispose());
  const initial = await runtime.getState({ refs: [viewRef] });
  const unchanged = await runtime.getState({ refs: [viewRef], since: initial.token });
  assert.equal(unchanged.mode, 'delta');
  if (unchanged.mode === 'delta')
    assert.deepEqual(unchanged.delta, {
      changed: {},
      removed: [],
      summaryChanged: undefined,
      summaryRemoved: undefined,
    });
  set({ state: { [teamRef]: { value: 'A' } }, summary: { [teamRef]: { count: 4 } } });
  const changed = await runtime.getState({ refs: [viewRef], since: initial.token });
  assert.equal(changed.mode, 'delta');
  if (changed.mode === 'delta') assert.deepEqual(changed.delta.summaryChanged, { [teamRef]: { count: 4 } });
});

test('a ref present with an undefined value and an absent ref are different states for every reader', async (t) => {
  const { runtime, set } = source({ state: { [teamRef]: undefined }, summary: { [otherRef]: 1 } });
  t.after(() => runtime.dispose());
  const first = await runtime.getState();
  set({ state: {}, summary: { [otherRef]: 1 } });
  const second = await runtime.getState();
  assert.notEqual(second.token, first.token);
  const update = await runtime.getState({ since: first.token });
  assert.equal(update.mode, 'delta');
  if (update.mode === 'delta')
    assert.deepEqual(update.delta, {
      changed: {},
      removed: [teamRef],
      summaryChanged: undefined,
      summaryRemoved: undefined,
    });
});

test('a summary ref present with an undefined value and an absent one are different summaries', async (t) => {
  const { runtime, set } = source({ state: { [teamRef]: 1 }, summary: { [athleteRef]: undefined, [otherRef]: 1 } });
  t.after(() => runtime.dispose());
  const first = await runtime.getState();
  set({ state: { [teamRef]: 1 }, summary: { [otherRef]: 1 } });
  const second = await runtime.getState();
  assert.notEqual(second.token, first.token);
  const update = await runtime.getState({ since: first.token });
  assert.equal(update.mode, 'delta');
  if (update.mode === 'delta')
    assert.deepEqual(update.delta, {
      changed: {},
      removed: [],
      summaryChanged: undefined,
      summaryRemoved: [athleteRef],
    });
});
