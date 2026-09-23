import assert from 'node:assert/strict';
import test from 'node:test';
import { createVacpRuntime } from '../src/index';
import type { VacpAgentActivity } from '@vacp/protocol';

test('host activity is isolated, ephemeral, cancellable, and immune to stale turn updates', () => {
  const runtime = createVacpRuntime({ providers: [] });
  const events: VacpAgentActivity[] = [];
  const actor = { id: 'analyst', kind: 'agent' as const };
  runtime.subscribeAgentActivities(() => {
    throw new Error('broken viewer');
  });
  runtime.subscribeAgentActivities((event) => {
    events.push(event);
    event.actor.label = 'viewer mutation';
  });
  const first = runtime.beginAgentActivity({ actor, summary: 'Comparing sports' });
  const snapshot = runtime.getAgentActivities();
  assert.equal(snapshot[0]?.summary, 'Comparing sports');
  assert.equal(snapshot[0]?.actor.label, undefined);
  const abort = new AbortController();
  const second = runtime.beginAgentActivity({ actor, summary: 'Checking medalists', signal: abort.signal });
  first.update('stale summary');
  first.end();
  assert.equal(runtime.getAgentActivities()[0]?.summary, 'Checking medalists');
  second.update('Comparing the selected athletes');
  abort.abort();
  assert.equal(events.at(-1)?.phase, 'cancelled');
  assert.deepEqual(runtime.getAgentActivities(), []);
  second.update('late');
  const third = runtime.beginAgentActivity({ actor });
  runtime.update({ providers: [], sessionKey: 'new' });
  assert.deepEqual(runtime.getAgentActivities(), []);
  third.update('old session');
  runtime.dispose();
  assert.throws(() => runtime.beginAgentActivity({ actor }));
});

test('invalid public summaries are rejected before superseding a live session', () => {
  const runtime = createVacpRuntime({ providers: [] });
  const actor = { id: 'analyst', kind: 'agent' as const };
  const turn = runtime.beginAgentActivity({ actor, summary: 'Reading the chart' });
  assert.throws(() => runtime.beginAgentActivity({ actor, summary: 'a'.repeat(501) }));
  assert.equal(runtime.getAgentActivities()[0]?.summary, 'Reading the chart');
  turn.end({ summary: 'Comparison complete' });
  assert.deepEqual(runtime.getAgentActivities(), []);
  runtime.dispose();
});

test('an action record keeps the narration the actor streamed while the action ran', async () => {
  let release = () => {};
  const started = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runtime = createVacpRuntime({
    providers: [
      {
        source: { id: 'vacp-source://narrated', type: 'test', title: 'Narrated' },
        observe: () => ({
          revision: 'static',
          observedAt: '',
          graph: {
            version: '0.1.0',
            nodes: [{ ref: 'vacp://narrated/value', kind: 'Param', layer: 'ConfigLayer' }],
            edges: [],
            actions: [
              {
                name: 'set',
                description: 'Set the value',
                operation: { kind: 'mutation', affects: ['vacp://narrated/value'] },
              },
            ],
          },
          state: { 'vacp://narrated/value': 1 },
        }),
        prepare: async (call) => ({
          intent: { affects: ['vacp://narrated/value'] },
          execute: async () => {
            await started;
            return { callId: call.callId, ok: true };
          },
        }),
      },
    ],
  });
  try {
    const actor = { id: 'analyst', kind: 'agent' as const };
    const turn = runtime.beginAgentActivity({ actor, summary: 'Raising the threshold' });
    const running = runtime.execute({ callId: 'c1', name: 'set', params: {} }, { actor });
    turn.update('Raising the threshold to 35 so the outliers stand out');
    release();
    assert.equal((await running).ok, true);
    const record = runtime.getProvenance().records.find((entry) => entry.kind === 'action');
    assert.equal(record?.message, 'Raising the threshold to 35 so the outliers stand out');
    turn.end({ summary: 'Outliers are now visible.' });
    assert.equal(record?.message, 'Raising the threshold to 35 so the outliers stand out');
  } finally {
    runtime.dispose();
  }
});
