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

test('a step carries the words it began with; words that arrive while it runs belong to what follows', async () => {
  let release = () => {};
  const started = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runtime = createVacpRuntime({
    providers: [
      {
        subscribe: () => () => {},
        source: { id: 'vacp-source://narrated', type: 'test', title: 'Narrated' },
        observe: () => ({
          revision: 'static',
          observedAt: '',
          graph: {
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
    assert.equal(record?.kind === 'action' && record.execution.narration, 'Raising the threshold');
    turn.end();
    const ended = runtime.getProvenance().records.at(-1);
    assert.equal(ended?.kind === 'turn' && ended.message, 'Raising the threshold to 35 so the outliers stand out');
  } finally {
    runtime.dispose();
  }
});

test('each step keeps its own words, and a step without new words never repeats the previous one', async () => {
  let value = 0;
  const runtime = createVacpRuntime({
    providers: [
      {
        subscribe: () => () => {},
        source: { id: 'vacp-source://steps', type: 'test', title: 'Steps' },
        observe: () => ({
          revision: String(value),
          observedAt: '',
          graph: {
            nodes: [{ ref: 'vacp://steps/value', kind: 'Param', layer: 'ConfigLayer' }],
            edges: [],
            actions: [
              {
                name: 'set',
                description: 'Set the value',
                operation: { kind: 'mutation', affects: ['vacp://steps/value'] },
              },
            ],
          },
          state: { 'vacp://steps/value': value },
        }),
        prepare: async (call) => ({
          intent: { affects: ['vacp://steps/value'] },
          execute: async () => {
            value++;
            return { callId: call.callId, ok: true };
          },
        }),
      },
    ],
  });
  const actor = { id: 'agent', kind: 'agent' as const };
  try {
    const turn = runtime.beginAgentActivity({ actor, summary: 'Filtering for female swimmers and gymnasts.' });
    const name = (await runtime.getCapabilities()).graph.actions[0]!.name;
    await runtime.execute({ callId: 'sex', name }, { actor });
    await runtime.execute({ callId: 'sports', name }, { actor });
    await runtime.execute({ callId: 'age', name }, { actor, narration: 'Narrowing to ages 18 to 25.' });
    turn.update('Keeping the youngest medalists in view.');
    await runtime.execute({ callId: 'medals', name }, { actor });
    const messages = runtime
      .getProvenance()
      .records.flatMap((record) => (record.kind === 'action' ? [record.execution.narration] : []));
    assert.deepEqual(messages, [
      'Filtering for female swimmers and gymnasts.',
      undefined,
      'Narrowing to ages 18 to 25.',
      'Keeping the youngest medalists in view.',
    ]);
    turn.end();
  } finally {
    runtime.dispose();
  }
});

test('a finished turn is recorded with its opening and closing words, and its steps carry the turn', async () => {
  let value = 0;
  const runtime = createVacpRuntime({
    providers: [
      {
        subscribe: () => () => {},
        source: { id: 'vacp-source://turn', type: 'test', title: 'Turn' },
        observe: () => ({
          revision: String(value),
          observedAt: '',
          graph: {
            nodes: [{ ref: 'vacp://turn/value', kind: 'Param', layer: 'ConfigLayer' }],
            edges: [],
            actions: [
              { name: 'set', description: 'Set', operation: { kind: 'mutation', affects: ['vacp://turn/value'] } },
            ],
          },
          state: { 'vacp://turn/value': value },
        }),
        prepare: async (call) => ({
          intent: { affects: ['vacp://turn/value'] },
          execute: async () => {
            value++;
            return { callId: call.callId, ok: true };
          },
        }),
      },
    ],
  });
  const actor = { id: 'agent', kind: 'agent' as const };
  try {
    const name = (await runtime.getCapabilities()).graph.actions[0]!.name;
    const turn = runtime.beginAgentActivity({ actor, summary: 'Filtering for young athletes.' });
    await runtime.execute({ callId: 'one', name }, { actor, narration: 'Keeping ages under 25.' });
    turn.update('Adding the medal counts.');
    await runtime.execute({ callId: 'two', name }, { actor });
    turn.end({ summary: 'Young medalists are in view.' });
    const records = runtime.getProvenance().records;
    const steps = records.filter((record) => record.kind === 'action');
    const ended = records.find((record) => record.kind === 'turn');
    assert.ok(ended && ended.kind === 'turn');
    assert.equal(ended.opening, 'Filtering for young athletes.');
    assert.equal(ended.message, 'Young medalists are in view.');
    assert.equal(ended.outcome, 'completed');
    assert.deepEqual(
      steps.map((step) => step.kind === 'action' && step.execution.activityId),
      [ended.activityId, ended.activityId],
    );
    // A turn whose first words arrive with its first step has no separate opening.
    const quiet = runtime.beginAgentActivity({ actor, summary: 'Keeping ages over 30.' });
    await runtime.execute({ callId: 'three', name }, { actor });
    quiet.end();
    const last = runtime.getProvenance().records.at(-1);
    assert.equal(last?.kind === 'turn' ? last.opening : 'missing', undefined);
    // Ending without new words keeps the step's sentence with the step, not as the closing sentence.
    assert.equal(last?.kind === 'turn' ? last.message : 'missing', undefined);
  } finally {
    runtime.dispose();
  }
});

test('narration opens one turn per actor, closes on done, and closes a quiet turn only when no step is in flight', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release = () => {};
  const runtime = createVacpRuntime({
    providers: [
      {
        subscribe: () => () => {},
        source: { id: 'vacp-source://narrator', type: 'test', title: 'Narrator' },
        observe: () => ({
          revision: 'static',
          observedAt: '',
          graph: {
            nodes: [{ ref: 'vacp://narrator/value', kind: 'Param', layer: 'ConfigLayer' }],
            edges: [],
            actions: [
              { name: 'set', description: 'Set', operation: { kind: 'mutation', affects: ['vacp://narrator/value'] } },
            ],
          },
          state: { 'vacp://narrator/value': 0 },
        }),
        prepare: async (call) => ({
          intent: { affects: ['vacp://narrator/value'] },
          execute: () =>
            new Promise((resolve) => {
              release = () => resolve({ callId: call.callId, ok: true });
            }),
        }),
      },
    ],
  });
  t.after(() => runtime.dispose());
  const actor = { id: 'agent', kind: 'agent' as const };
  const turns = () => runtime.getProvenance().records.filter((record) => record.kind === 'turn');
  runtime.narrate({ actor, message: 'Comparing paddle sports.' });
  runtime.narrate({ actor, message: 'Comparing canoe and rowing.' });
  assert.equal(runtime.getAgentActivities().length, 1);
  assert.equal(runtime.getAgentActivities()[0]?.summary, 'Comparing canoe and rowing.');
  runtime.narrate({ actor, message: 'Both sports are in view.', done: true });
  assert.equal(runtime.getAgentActivities().length, 0);
  assert.equal(turns().at(-1)?.kind === 'turn' && turns().at(-1)!.message, 'Both sports are in view.');
  assert.throws(() => runtime.narrate({ actor, message: '   ' }), /requires a sentence/);

  runtime.narrate({ actor, message: 'Checking the age range.' });
  const running = runtime.execute({ callId: 'slow', name: 'set' }, { actor, narration: 'Narrowing to ages 20 to 30.' });
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(60_000);
  assert.equal(runtime.getAgentActivities().length, 1, 'a step in flight keeps its turn open');
  release();
  await running;
  t.mock.timers.tick(60_000);
  assert.equal(runtime.getAgentActivities().length, 0);
  const steps = runtime.getProvenance().records.filter((record) => record.kind === 'action');
  assert.equal(
    steps.at(-1)?.kind === 'action' && steps.at(-1)!.execution.activityId,
    turns().at(-1)?.kind === 'turn' && turns().at(-1)!.activityId,
  );
});

function stepRuntime() {
  return createVacpRuntime({
    providers: [
      {
        subscribe: () => () => {},
        source: { id: 'vacp-source://steps', type: 'test', title: 'Steps' },
        observe: () => ({
          revision: 'static',
          observedAt: '',
          graph: {
            nodes: [{ ref: 'vacp://steps/value', kind: 'Param', layer: 'ConfigLayer' }],
            edges: [],
            actions: [
              { name: 'set', description: 'Set', operation: { kind: 'mutation', affects: ['vacp://steps/value'] } },
            ],
          },
          state: { 'vacp://steps/value': 0 },
        }),
        prepare: async (call) => ({
          intent: { affects: ['vacp://steps/value'] },
          execute: async () => ({ callId: call.callId, ok: true }),
        }),
      },
    ],
  });
}

test('an agent’s first step opens its turn, and the closing words end that turn with every step in it', async (t) => {
  const runtime = stepRuntime();
  t.after(() => runtime.dispose());
  const actor = { id: 'agent', kind: 'agent' as const };
  await runtime.execute({ callId: 'sex', name: 'set' }, { actor, narration: 'Keeping female athletes.' });
  await runtime.execute({ callId: 'sport', name: 'set' }, { actor, narration: 'Keeping aquatics.' });
  assert.equal(runtime.getAgentActivities().length, 1, 'the request stays one open turn between its steps');
  runtime.narrate({ actor, message: 'Female swimmers are in view.', done: true });
  const records = runtime.getProvenance().records;
  const turns = records.filter((record) => record.kind === 'turn');
  const steps = records.filter((record) => record.kind === 'action');
  assert.equal(turns.length, 1);
  assert.deepEqual(
    steps.map((step) => step.kind === 'action' && [step.execution.activityId, step.execution.narration]),
    [
      [turns[0]!.kind === 'turn' && turns[0]!.activityId, 'Keeping female athletes.'],
      [turns[0]!.kind === 'turn' && turns[0]!.activityId, 'Keeping aquatics.'],
    ],
  );
  assert.equal(turns[0]!.kind === 'turn' && turns[0]!.opening, undefined, 'a step’s words never become the opening');
  assert.equal(turns[0]!.kind === 'turn' && turns[0]!.message, 'Female swimmers are in view.');
});

test('steps keep a turn open, and it closes after a quiet spell once the last step ends', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const runtime = stepRuntime();
  t.after(() => runtime.dispose());
  const actor = { id: 'agent', kind: 'agent' as const };
  runtime.narrate({ actor, message: 'Comparing swimmers.' });
  t.mock.timers.tick(40_000);
  await runtime.execute({ callId: 'first', name: 'set' }, { actor, narration: 'Keeping aquatics.' });
  t.mock.timers.tick(40_000);
  assert.equal(runtime.getAgentActivities().length, 1, 'the step restarted the quiet spell');
  await runtime.execute({ callId: 'second', name: 'set' }, { actor, narration: 'Keeping ages 20 to 30.' });
  t.mock.timers.tick(59_000);
  assert.equal(runtime.getAgentActivities().length, 1, 'a reasoning pause between steps stays in the request');
  t.mock.timers.tick(1_000);
  assert.equal(runtime.getAgentActivities().length, 0);
  const records = runtime.getProvenance().records;
  const turn = records.find((record) => record.kind === 'turn');
  assert.ok(turn?.kind === 'turn');
  assert.equal(turn.opening, 'Comparing swimmers.');
  for (const step of records.filter((record) => record.kind === 'action'))
    assert.equal(step.kind === 'action' && step.execution.activityId, turn.activityId);
});

test('a person’s or the system’s step opens no agent turn', async (t) => {
  const runtime = stepRuntime();
  t.after(() => runtime.dispose());
  await runtime.execute({ callId: 'human', name: 'set' }, { actor: { id: 'person', kind: 'human' } });
  await runtime.execute({ callId: 'system', name: 'set' }, { actor: { id: 'app', kind: 'system' } });
  assert.deepEqual(runtime.getAgentActivities(), []);
  for (const step of runtime.getProvenance().records.filter((record) => record.kind === 'action'))
    assert.equal(step.kind === 'action' && step.execution.activityId, undefined);
});

test('an agent that acts before it narrates keeps one turn through its later sentences', async (t) => {
  const runtime = stepRuntime();
  t.after(() => runtime.dispose());
  const actor = { id: 'agent', kind: 'agent' as const };
  await runtime.execute({ callId: 'sex', name: 'set' }, { actor, narration: 'Keeping female athletes.' });
  runtime.narrate({ actor, message: 'Next I compare the sports.' });
  await runtime.execute({ callId: 'sport', name: 'set' }, { actor, narration: 'Keeping aquatics.' });
  runtime.narrate({ actor, message: 'Female swimmers are in view.', done: true });
  const records = runtime.getProvenance().records;
  const turns = records.filter((record) => record.kind === 'turn');
  assert.equal(turns.length, 1);
  assert.equal(turns[0]!.kind === 'turn' && turns[0]!.outcome, 'completed');
  assert.equal(turns[0]!.kind === 'turn' && turns[0]!.message, 'Female swimmers are in view.');
  for (const step of records.filter((record) => record.kind === 'action'))
    assert.equal(
      step.kind === 'action' && step.execution.activityId,
      turns[0]!.kind === 'turn' && turns[0]!.activityId,
    );
});

test('narration joins a turn its host began, and the host’s later end leaves the closed turn alone', async (t) => {
  const runtime = stepRuntime();
  t.after(() => runtime.dispose());
  const actor = { id: 'agent', kind: 'agent' as const };
  const host = runtime.beginAgentActivity({ actor });
  runtime.narrate({ actor, message: 'Looking at the age spread.' });
  await runtime.execute({ callId: 'age', name: 'set' }, { actor, narration: 'Narrowing to ages 18 to 25.' });
  runtime.narrate({ actor, message: 'Most medalists are 22 to 28.', done: true });
  host.end({ outcome: 'failed' });
  const turns = runtime.getProvenance().records.filter((record) => record.kind === 'turn');
  assert.deepEqual(
    turns.map((turn) => turn.kind === 'turn' && [turn.outcome, turn.opening, turn.message]),
    [['completed', 'Looking at the age spread.', 'Most medalists are 22 to 28.']],
  );
});
