import assert from 'node:assert/strict';
import test from 'node:test';

import type { VacpStateSnapshot } from '@vacp/core';

import { buildStateUpdate, scopeStateSnapshot } from '../src/runtime/state-update';

const createdAt = '2026-03-06T10:00:00.000Z';
const viewRef = 'vacp://test-app/example-view';
const teamRef = `${viewRef}/input/0`;
const athleteRef = `${viewRef}/input/1`;
const dataRef = `${viewRef}/data/main`;
const auxiliaryRef = `${viewRef}/data/auxiliary`;

test('scopeStateSnapshot expands container refs to descendant state and summary entries', () => {
  const snapshot: VacpStateSnapshot = {
    version: '0.1.0',
    createdAt,
    state: {
      [teamRef]: { value: '' },
      [athleteRef]: { value: '' },
      [dataRef]: { selectionWhere: null },
      [auxiliaryRef]: { table: 'auxiliary' },
      'vacp://other/view/input/0': { value: 'other' },
    },
    summary: {
      [athleteRef]: { label: 'Athlete' },
      [dataRef]: { kind: 'DataHandle' },
      'vacp://other/view/input/0': { label: 'Other' },
    },
  };

  const scoped = scopeStateSnapshot(snapshot, { mode: 'full', refs: [viewRef], includeSummary: true });

  assert.deepEqual(scoped.refs, [viewRef]);
  assert.deepEqual(new Set(Object.keys(scoped.snapshot.state)), new Set([teamRef, athleteRef, dataRef, auxiliaryRef]));
  assert.deepEqual(new Set(Object.keys(scoped.snapshot.summary ?? {})), new Set([athleteRef, dataRef]));
});

test('buildStateUpdate rescopes broader baselines before computing a narrower delta', () => {
  const baseline: VacpStateSnapshot = {
    version: '0.1.0',
    createdAt,
    state: {
      [teamRef]: { value: '' },
      [athleteRef]: { value: '' },
      [dataRef]: { selectionWhere: null },
      [auxiliaryRef]: { table: 'auxiliary' },
    },
  };

  const current: VacpStateSnapshot = {
    version: '0.1.0',
    createdAt,
    state: {
      [teamRef]: { value: '' },
      [athleteRef]: { value: 'Example Item' },
      [dataRef]: { selectionWhere: `category = 'Example Item'` },
      [auxiliaryRef]: { table: 'auxiliary' },
    },
  };

  const update = buildStateUpdate({
    current,
    request: {
      mode: 'delta',
      since: 'st_prev',
      refs: [teamRef, athleteRef, dataRef],
      includeSummary: true,
    },
    baseline,
  });

  assert.equal(update.mode, 'delta');
  assert.deepEqual(update.scope, { refs: [dataRef, teamRef, athleteRef] });
  assert.deepEqual(update.delta.removed, []);
  assert.deepEqual(update.delta.changed, {
    [athleteRef]: { value: 'Example Item' },
    [dataRef]: { selectionWhere: `category = 'Example Item'` },
  });
});
