import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { VacpExecution, VacpFreshness, VacpInteraction, VacpSourceId } from '@ethivia/vacp-protocol';
import { createVacpProvider, createVacpRuntime, VacpActionRegistry } from '@ethivia/vacp-runtime';
import {
  createAgentPresence,
  paceAgentPresence,
  type PresenceActivity,
  type PresencePresentation,
  type PresenceFrame,
  type PresenceTarget,
} from '../src/index';

/** Entries still showing a step or a located target. An actor mid-turn stays, with nowhere to rest. */
const shown = (presence: { getSnapshot(): readonly PresenceActivity[] }) =>
  presence.getSnapshot().filter((activity) => activity.execution || activity.target);

const target: PresenceTarget = {
  surface: 'test',
  precision: 'exact',
  geometry: { kind: 'point', point: { x: 10, y: 20 } },
};
function fixture(interaction?: VacpInteraction) {
  const actions = new VacpActionRegistry();
  let executions = 0;
  let freshness: VacpFreshness = { status: 'running' };
  actions.register(
    { name: 'set', description: 'Set', operation: { kind: 'mutation', affects: ['vacp://plot'] } },
    () => ++executions,
    { parse: (value) => value, focus: (value) => ({ ref: 'vacp://plot', detail: value, interaction }) },
  );
  const provider = createVacpProvider({
    subscribe: () => () => {},
    source: { id: 'vacp-source://test', type: 'test', title: 'Test' },
    actions,
    project: () => ({
      graph: {
        nodes: [{ ref: 'vacp://plot', kind: 'View', layer: 'ViewLayer' }],
        edges: [],
        actions: actions.list(),
      },
      state: { 'vacp://plot': executions },
      freshness: { 'vacp://plot': freshness },
    }),
  });
  const runtime = createVacpRuntime({ providers: [provider] });
  return {
    runtime,
    provider,
    count: () => executions,
    settle: () => {
      freshness = { status: 'current' };
    },
  };
}

function syntheticProvider(id: VacpSourceId) {
  return createVacpProvider({
    source: { id, type: 'test', title: 'Test' },
    actions: new VacpActionRegistry(),
    project: () => ({ graph: { nodes: [], edges: [], actions: [] }, state: {} }),
    subscribe: () => () => {},
  });
}

test('presence is independent of execution and distinguishes completion from freshness', async () => {
  const f = fixture();
  let rendered: readonly PresenceActivity[] = [];
  let resolveTarget!: (value: PresenceTarget) => void;
  const pendingTarget = new Promise<PresenceTarget>((resolve) => {
    resolveTarget = resolve;
  });
  const presence = createAgentPresence(f.runtime, {
    renderer: {
      render: ({ activities }) => {
        rendered = activities;
      },
    },
  });
  presence.attach(f.provider, {
    resolve: () => pendingTarget,
  });
  try {
    await f.runtime.execute({ callId: 'set', name: 'set' });
    assert.equal(f.count(), 1);
    assert.equal(rendered[0]!.target, null);
    assert.equal(rendered[0]!.execution!.phase, 'succeeded');
    assert.equal(rendered[0]!.freshness, 'updating');
    resolveTarget(target);
    await setImmediate();
    assert.deepEqual(rendered[0]!.target, target);
    f.settle();
    await f.runtime.refresh();
    assert.equal(rendered[0]!.freshness, 'current');
    presence.dispose();
    await f.runtime.execute({ callId: 'unobserved', name: 'set' });
    assert.equal(f.count(), 2);
    assert.deepEqual(rendered, []);
  } finally {
    presence.dispose();
    f.runtime.dispose();
  }
});

test('a later action keeps actor focus when an earlier target resolves', async () => {
  const f = fixture();
  let finish!: (value: PresenceTarget) => void;
  const slow = new Promise<PresenceTarget>((resolve) => {
    finish = resolve;
  });
  const presence = createAgentPresence(f.runtime);
  presence.attach(f.provider, {
    resolve: (focus) => (focus.detail === 0 ? slow : target),
  });
  try {
    await f.runtime.execute({ callId: 'earlier', name: 'set', params: 0 });
    await f.runtime.execute({ callId: 'current', name: 'set', params: 1 });
    finish({ ...target, geometry: { kind: 'point', point: { x: 99, y: 99 } } });
    await setImmediate();
    assert.equal(f.count(), 2);
    assert.equal(presence.getSnapshot()[0]!.execution!.callId, 'current');
    assert.deepEqual(presence.getSnapshot()[0]!.target, target);
    f.runtime.update({ providers: [] });
    assert.deepEqual(shown(presence), []);
  } finally {
    presence.dispose();
    f.runtime.dispose();
  }
});

test('missing targets and throwing renderers do not alter results, and viewers are independent', async () => {
  const f = fixture();
  const errors: unknown[] = [];
  const broken = createAgentPresence(f.runtime, {
    renderer: {
      render: () => {
        throw new Error('render');
      },
    },
    onError: (error) => errors.push(error),
  });
  const healthy = createAgentPresence(f.runtime);
  try {
    const result = await f.runtime.execute({ callId: 'invisible', name: 'set' });
    assert.equal(result.ok, true);
    assert.equal(healthy.getSnapshot()[0]!.target, null);
    assert.ok(errors.length > 0);
    broken.dispose();
    await f.runtime.execute({ callId: 'next', name: 'set' });
    assert.equal(healthy.getSnapshot()[0]!.execution!.callId, 'next');
  } finally {
    broken.dispose();
    healthy.dispose();
    f.runtime.dispose();
  }
});

test('replacing a source retires pending geometry and its old binding cannot target the replacement', async () => {
  const f = fixture();
  let finish!: (target: PresenceTarget) => void;
  const pending = new Promise<PresenceTarget>((resolve) => {
    finish = resolve;
  });
  const presence = createAgentPresence(f.runtime);
  const lease = f.runtime.getProviderBinding(f.provider);
  presence.attach(f.provider, { resolve: () => pending });
  try {
    await f.runtime.execute({ callId: 'old', name: 'set' });
    f.runtime.update({ providers: [{ ...f.provider }] });
    assert.equal(lease.signal.aborted, true);
    finish(target);
    await setImmediate();
    assert.deepEqual(shown(presence), []);
    await f.runtime.execute({ callId: 'replacement', name: 'set' });
    assert.equal(presence.getSnapshot()[0]!.target, null);
  } finally {
    presence.dispose();
    f.runtime.dispose();
  }
});

test('configured pacing delays mutation and result delivery independently', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const phases: string[] = [];
  f.runtime.subscribeExecutions((execution) => phases.push(execution.phase));
  const presence = createAgentPresence(f.runtime);
  paceAgentPresence(f.runtime, presence, { arrivalTimeoutMs: 0, beforeExecuteMs: 40, afterExecuteMs: 50 });
  let returned = false;
  try {
    const execution = f.runtime.execute({ callId: 'paced', name: 'set' }).then((result) => {
      returned = true;
      return result;
    });
    // Drain ready continuations so the pre-execution gate is waiting on controlled time.
    await setImmediate();
    assert.equal(phases.at(-1), 'prepared');
    t.mock.timers.tick(39);
    await setImmediate();
    assert.equal(f.count(), 0);
    t.mock.timers.tick(1);
    await setImmediate();
    assert.equal(f.count(), 1);
    assert.equal(phases.at(-1), 'succeeded');
    t.mock.timers.tick(49);
    await setImmediate();
    assert.equal(returned, false);
    t.mock.timers.tick(1);
    assert.equal((await execution).ok, true);
  } finally {
    presence.dispose();
    f.runtime.dispose();
  }
});

test('disposal releases an intentional pre-execution pause', async () => {
  const f = fixture();
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const presence = createAgentPresence(f.runtime, {
    renderer: {
      render: () => {},
      arrive: async () => {
        entered();
      },
    },
  });
  presence.attach(f.provider, {
    resolve: () => target,
  });
  paceAgentPresence(f.runtime, presence, { beforeExecuteMs: 30_000 });
  try {
    const result = f.runtime.execute({ callId: 'released', name: 'set' });
    await waiting;
    presence.dispose();
    assert.equal((await result).ok, true);
    assert.equal(f.count(), 1);
  } finally {
    presence.dispose();
    f.runtime.dispose();
  }
});

test(
  'coherent observations refresh geometry even when the surface has no layout events',
  { timeout: 2000 },
  async () => {
    const f = fixture();
    const presence = createAgentPresence(f.runtime);
    let x = 10;
    presence.attach(f.provider, {
      resolve: () => ({ surface: 'canvas', precision: 'exact', geometry: { kind: 'point', point: { x, y: 20 } } }),
    });
    try {
      await f.runtime.execute({ callId: 'canvas', name: 'set' });
      const updated = new Promise<void>((resolve) => {
        const detach = presence.subscribe((activities) => {
          const geometry = activities[0]?.target?.geometry;
          if (geometry?.kind === 'point' && geometry.point.x === 40) {
            detach();
            resolve();
          }
        });
      });
      x = 40;
      f.settle();
      await f.runtime.refresh();
      await updated;
    } finally {
      presence.dispose();
      f.runtime.dispose();
    }
  },
);

test('passive viewers need no timing authority and removing host pacing leaves both viewers attached', async () => {
  const f = fixture();
  const passive = {
    signal: f.runtime.signal,
    subscribeExecutions: f.runtime.subscribeExecutions.bind(f.runtime),
    getActiveExecutions: f.runtime.getActiveExecutions.bind(f.runtime),
    subscribeSnapshots: f.runtime.subscribeSnapshots.bind(f.runtime),
    getAgentActivities: f.runtime.getAgentActivities.bind(f.runtime),
    subscribeAgentActivities: f.runtime.subscribeAgentActivities.bind(f.runtime),
    getProviderBinding: f.runtime.getProviderBinding.bind(f.runtime),
  };
  const first = createAgentPresence(passive),
    second = createAgentPresence(passive);
  const remove = paceAgentPresence(f.runtime, first, { arrivalTimeoutMs: 0, beforeExecuteMs: 30_000 });
  let prepared!: () => void;
  const ready = new Promise<void>((resolve) => {
    prepared = resolve;
  });
  f.runtime.subscribeExecutions((event) => {
    if (event.phase === 'prepared') prepared();
  });
  try {
    const action = f.runtime.execute({ callId: 'host-paced', name: 'set' });
    await ready;
    assert.equal(f.count(), 0);
    remove();
    assert.equal((await action).ok, true);
    assert.equal(first.getSnapshot()[0]!.execution!.phase, 'succeeded');
    assert.equal(second.getSnapshot()[0]!.execution!.phase, 'succeeded');
  } finally {
    remove();
    first.dispose();
    second.dispose();
    f.runtime.dispose();
  }
});

test('custom interaction meaning reaches headless consumers without granting execution control', async () => {
  const f = fixture({ kind: 'lasso', axis: 'xy' });
  const presence = createAgentPresence(f.runtime);
  try {
    await f.runtime.execute({ callId: 'custom', name: 'set' });
    const observation = presence.getSnapshot();
    assert.deepEqual(observation[0]!.execution!.intent?.focus?.interaction, { kind: 'lasso', axis: 'xy' });
    assert.throws(() => {
      observation[0]!.execution!.intent!.focus!.interaction!.kind = 'changed by viewer';
    });
    assert.equal(presence.getSnapshot()[0]!.execution!.intent?.focus?.interaction?.kind, 'lasso');
    assert.equal(f.count(), 1);
  } finally {
    presence.dispose();
    f.runtime.dispose();
  }
});

test('geometry invalidation during renderer arrival waits for the replacement target', { timeout: 2000 }, async () => {
  const f = fixture();
  let invalidate = () => {};
  let entered!: () => void;
  const rendering = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let resolveTarget!: (target: PresenceTarget) => void;
  const replacement = new Promise<PresenceTarget>((resolve) => {
    resolveTarget = resolve;
  });
  let geometry: PresenceTarget | Promise<PresenceTarget> = target;
  let arrivals = 0;
  let arrivedTarget: PresenceTarget | null = null;
  const presence = createAgentPresence(f.runtime, {
    renderer: {
      render: () => {},
      arrive: () => {
        arrivals++;
        if (arrivals === 1) {
          entered();
          return new Promise<void>(() => {});
        }
        arrivedTarget = presence.getSnapshot()[0]!.target;
        return Promise.resolve();
      },
    },
  });
  presence.attach(f.provider, {
    resolve: () => geometry,
    subscribe: (notify) => {
      invalidate = notify;
      return () => {};
    },
  });
  try {
    await f.runtime.execute({ callId: 'moving', name: 'set' });
    let finished = false;
    const arrival = presence.arrive(presence.getSnapshot()[0]!.execution!.id, new AbortController().signal).then(() => {
      finished = true;
    });
    await rendering;
    geometry = replacement;
    invalidate();
    await setImmediate();
    assert.equal(finished, false);
    resolveTarget({ ...target, geometry: { kind: 'point', point: { x: 40, y: 50 } } });
    await arrival;
    assert.deepEqual(arrivedTarget, { ...target, geometry: { kind: 'point', point: { x: 40, y: 50 } } });
  } finally {
    presence.dispose();
    f.runtime.dispose();
  }
});

test(
  'detaching a source releases arrival even when a custom renderer ignores cancellation',
  { timeout: 2000 },
  async () => {
    const f = fixture();
    let entered!: () => void;
    const rendering = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const presence = createAgentPresence(f.runtime, {
      renderer: {
        render: () => {},
        arrive: () => {
          entered();
          return new Promise<void>(() => {});
        },
      },
    });
    const detach = presence.attach(f.provider, {
      resolve: () => target,
    });
    try {
      await f.runtime.execute({ callId: 'retired', name: 'set' });
      const arrival = presence.arrive(presence.getSnapshot()[0]!.execution!.id, new AbortController().signal);
      await rendering;
      detach();
      await arrival;
      assert.deepEqual(shown(presence), []);
    } finally {
      presence.dispose();
      f.runtime.dispose();
    }
  },
);

test(
  'arrival follows replacement geometry and releases unresolved work on cancellation and disposal',
  { timeout: 2000 },
  async () => {
    const f = fixture();
    const unresolved = new Promise<PresenceTarget>(() => {});
    let geometry: PresenceTarget | Promise<PresenceTarget> = unresolved;
    let invalidate = () => {};
    let arrivals = 0;
    const presence = createAgentPresence(f.runtime, {
      renderer: {
        render: () => {},
        arrive: async () => {
          arrivals++;
        },
      },
    });
    presence.attach(f.provider, {
      resolve: () => geometry,
      subscribe: (notify) => {
        invalidate = notify;
        return () => {};
      },
    });
    try {
      await f.runtime.execute({ callId: 'pending', name: 'set' });
      const id = presence.getSnapshot()[0]!.execution!.id;
      const cancelled = new AbortController();
      const first = presence.arrive(id, cancelled.signal);
      cancelled.abort();
      await first;
      assert.equal(arrivals, 0);

      const replaced = presence.arrive(id, new AbortController().signal);
      geometry = target;
      invalidate();
      await replaced;
      assert.equal(arrivals, 1);
      assert.deepEqual(presence.getSnapshot()[0]!.target, target);

      geometry = unresolved;
      invalidate();
      const disposed = presence.arrive(id, new AbortController().signal);
      presence.dispose();
      await disposed;
      assert.equal(arrivals, 1);
    } finally {
      presence.dispose();
      f.runtime.dispose();
    }
  },
);

test('host thinking stays visible before and between actions and is replayed to new viewers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const actor = { id: 'analyst', kind: 'agent' as const, label: 'Analyst' };
  const turn = f.runtime.beginAgentActivity({ actor, summary: 'Comparing sports' });
  const presence = createAgentPresence(f.runtime, { lingerMs: 100, narrationHoldMs: 0 });
  try {
    assert.equal(presence.getSnapshot()[0]?.phase, 'thinking');
    assert.equal(presence.getSnapshot()[0]?.execution, undefined);
    await f.runtime.execute({ name: 'set', callId: 'set' }, { actor });
    assert.equal(presence.getSnapshot()[0]?.phase, 'thinking');
    t.mock.timers.tick(200);
    assert.equal(presence.getSnapshot().length, 1);
    turn.update('Checking the result');
    assert.equal(presence.getSnapshot()[0]?.summary, 'Checking the result');
    turn.end({ summary: 'The comparison is ready' });
    assert.equal(presence.getSnapshot()[0]?.phase, 'completed');
    t.mock.timers.tick(100);
    assert.deepEqual(presence.getSnapshot(), []);
  } finally {
    presence.dispose();
    f.runtime.dispose();
  }
});

test('words about the next step wait for that step while the cursor rests on the last one', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const actor = { id: 'analyst', kind: 'agent' as const };
  const turn = f.runtime.beginAgentActivity({ actor, summary: 'Selecting rowing first' });
  const summaries: Array<string | undefined> = [];
  const presence = createAgentPresence(f.runtime, { narrationHoldMs: 1000 });
  presence.subscribe((activities) => summaries.push(activities[0]?.summary));
  try {
    // The first words of a turn have no earlier step to contradict, so they show at once.
    assert.equal(presence.getSnapshot()[0]?.summary, 'Selecting rowing first');
    await f.runtime.execute({ name: 'set', callId: 'first' }, { actor });
    assert.equal(presence.getSnapshot()[0]?.execution?.phase, 'succeeded');

    turn.update('Now narrowing the age range');
    assert.equal(presence.getSnapshot()[0]?.summary, 'Selecting rowing first');
    assert.equal(presence.getSnapshot()[0]?.phase, 'thinking');
    turn.update('Now narrowing the ages to the twenties');
    assert.equal(presence.getSnapshot()[0]?.summary, 'Selecting rowing first');
    await f.runtime.execute({ name: 'set', callId: 'second' }, { actor });
    assert.equal(presence.getSnapshot()[0]?.summary, 'Now narrowing the ages to the twenties');
    assert.equal(presence.getSnapshot()[0]?.execution?.phase, 'succeeded');
    assert.ok(!summaries.includes('Now narrowing the age range'));

    // Without a following step, the wait is bounded.
    turn.update('Reading the medal table');
    assert.equal(presence.getSnapshot()[0]?.summary, 'Now narrowing the ages to the twenties');
    t.mock.timers.tick(999);
    assert.equal(presence.getSnapshot()[0]?.summary, 'Now narrowing the ages to the twenties');
    t.mock.timers.tick(1);
    assert.equal(presence.getSnapshot()[0]?.summary, 'Reading the medal table');
    assert.equal(summaries.at(-1), 'Reading the medal table');

    // Closing words describe what is already on screen, so they never wait.
    turn.end({ summary: 'Rowers in their twenties are in view' });
    assert.equal(presence.getSnapshot()[0]?.summary, 'Rowers in their twenties are in view');
    assert.equal(presence.getSnapshot()[0]?.phase, 'completed');
  } finally {
    presence.dispose();
    f.runtime.dispose();
  }
});

test('a new turn stops claiming the last step is current, while the cursor keeps resting on it', async () => {
  const f = fixture();
  const actor = { id: 'analyst', kind: 'agent' as const };
  const presence = createAgentPresence(f.runtime, { narrationHoldMs: 0 });
  presence.attach(f.provider, {
    resolve: () => target,
  });
  try {
    const first = f.runtime.beginAgentActivity({ actor, summary: 'Selecting a range' });
    await f.runtime.execute({ name: 'set', callId: 'ranged' }, { actor });
    f.settle();
    await f.runtime.refresh();
    assert.equal(presence.getSnapshot()[0]?.freshness, 'current');
    assert.deepEqual(presence.getSnapshot()[0]?.target, target);
    first.end({ summary: 'The range is selected' });
    const second = f.runtime.beginAgentActivity({ actor, summary: 'Looking at the medal table' });
    const shown = presence.getSnapshot()[0]!;
    assert.equal(shown.execution, undefined);
    assert.equal(shown.freshness, 'unknown');
    assert.deepEqual(shown.target, target, 'the cursor rests where the actor last acted');
    second.end();
  } finally {
    presence.dispose();
    f.runtime.dispose();
  }
});

test('held words are dropped with their entry instead of surfacing after disposal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const actor = { id: 'analyst', kind: 'agent' as const };
  const turn = f.runtime.beginAgentActivity({ actor, summary: 'Selecting rowing' });
  const presence = createAgentPresence(f.runtime, { narrationHoldMs: 500 });
  let published = 0;
  presence.subscribe(() => published++);
  await f.runtime.execute({ name: 'set', callId: 'first' }, { actor });
  turn.update('Narrowing the ages');
  presence.dispose();
  const after = published;
  t.mock.timers.tick(600);
  assert.equal(published, after);
  turn.end();
  f.runtime.dispose();
});

test('a new host turn keeps focus when an older execution finishes', async () => {
  const f = fixture();
  const actor = { id: 'analyst', kind: 'agent' as const };
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  f.runtime.addExecutionGate(() => gate, { timeoutMs: 5000 });
  const presence = createAgentPresence(f.runtime);
  try {
    const old = f.runtime.execute({ name: 'set', callId: 'old' }, { actor });
    await setImmediate();
    const turn = f.runtime.beginAgentActivity({ actor, summary: 'A new comparison' });
    releaseGate();
    assert.equal((await old).ok, true);
    assert.equal(f.count(), 1);
    assert.equal(presence.getSnapshot()[0]?.phase, 'thinking');
    assert.equal(presence.getSnapshot()[0]?.execution, undefined);
    turn.end();
  } finally {
    releaseGate();
    presence.dispose();
    f.runtime.dispose();
  }
});

test('a viewer attached during host thinking and a prepared operation follows that action through completion', async () => {
  const f = fixture();
  let entered!: () => void;
  let proceed!: () => void;
  const prepared = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    proceed = resolve;
  });
  const ungate = f.runtime.addExecutionGate(
    () => {
      entered();
      return blocked;
    },
    { timeoutMs: 1000 },
  );
  const thinking = f.runtime.beginAgentActivity({
    actor: { id: 'agent', kind: 'agent' },
    summary: 'Selecting a range',
  });
  const operation = f.runtime.execute(
    { callId: 'already-prepared', name: 'set' },
    { actor: { id: 'agent', kind: 'agent' } },
  );
  await prepared;
  const presence = createAgentPresence(f.runtime);
  presence.attach(f.provider, {
    resolve: () => target,
  });
  await setImmediate();
  assert.equal(presence.getSnapshot()[0]?.execution?.phase, 'prepared');
  assert.equal(presence.getSnapshot()[0]?.phase, 'acting');
  assert.equal(presence.getSnapshot()[0]?.summary, 'Selecting a range');
  assert.deepEqual(presence.getSnapshot()[0]?.target, target);
  proceed();
  await operation;
  assert.equal(presence.getSnapshot()[0]?.execution?.phase, 'succeeded');
  assert.equal(presence.getSnapshot()[0]?.phase, 'thinking');
  thinking.end({ summary: 'The range is selected' });
  assert.equal(presence.getSnapshot()[0]?.phase, 'completed');
  presence.dispose();
  ungate();
  f.runtime.dispose();
});

test('published activity protects nested focus and geometry across viewers and later progress updates', async () => {
  const f = fixture();
  const work = f.runtime.beginAgentActivity({ actor: { id: 'agent', kind: 'agent' }, summary: 'Inspecting points' });
  const geometry: PresenceTarget = {
    surface: 'test',
    precision: 'exact',
    geometry: { kind: 'path', points: [{ x: 1, y: 2 }] },
  };
  const presence = createAgentPresence(f.runtime, { narrationHoldMs: 0 });
  presence.attach(f.provider, {
    resolve: () => geometry,
  });
  let newest: readonly PresenceActivity[] = [];
  presence.subscribe((activities) => {
    const item = activities[0];
    if (item?.target?.geometry.kind === 'path')
      assert.throws(() => {
        item.target!.geometry = { kind: 'point', point: { x: 99, y: 99 } };
      });
    const detail = item?.execution?.intent?.focus?.detail;
    if (detail && typeof detail === 'object' && 'date' in detail && detail.date instanceof Date)
      detail.date.setFullYear(2040);
  });
  presence.subscribe((activities) => {
    newest = activities;
  });
  try {
    await f.runtime.execute(
      { callId: 'isolated', name: 'set', params: { date: new Date('2020-01-01T00:00:00Z') } },
      { actor: { id: 'agent', kind: 'agent' } },
    );
    const first = presence.getSnapshot()[0]!;
    assert.deepEqual(first.target, geometry);
    const detail = newest[0]!.execution!.intent!.focus!.detail as { date: Date };
    assert.equal(detail.date.getUTCFullYear(), 2020);
    geometry.geometry = { kind: 'point', point: { x: 30, y: 40 } };
    work.update('Inspecting points, still');
    assert.deepEqual(presence.getSnapshot()[0]!.target, first.target);
    assert.equal(newest[0]!.target, first.target);
  } finally {
    presence.dispose();
    f.runtime.dispose();
  }
});

test('a sentence is shown for the step it began with, never repeated on the steps after it', async () => {
  const f = fixture();
  const actor = { id: 'analyst', kind: 'agent' as const };
  const presence = createAgentPresence(f.runtime, { narrationHoldMs: 0 });
  const during: Array<string | undefined> = [];
  presence.subscribe((activities) => {
    if (activities[0]?.phase === 'acting') during.push(activities[0].summary);
  });
  const turn = f.runtime.beginAgentActivity({ actor, summary: 'Filtering for female swimmers and gymnasts.' });
  try {
    // The trace that motivated this: one sentence, then several actions without new words.
    await f.runtime.execute({ name: 'set', callId: 'sex' }, { actor });
    await f.runtime.execute({ name: 'set', callId: 'sports' }, { actor });
    turn.update('Narrowing to ages 18 to 25.');
    await f.runtime.execute({ name: 'set', callId: 'age' }, { actor });
    assert.deepEqual(
      [...new Set(during)],
      ['Filtering for female swimmers and gymnasts.', undefined, 'Narrowing to ages 18 to 25.'],
    );
    turn.end();
  } finally {
    presence.dispose();
    f.runtime.dispose();
  }
});

test('without replay, a completed answer outlives the linger and leaves only when dismissed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const actor = { id: 'analyst', kind: 'agent' as const };
  let frame: PresenceFrame = { activities: [], reason: 'activity' };
  const presence = createAgentPresence(f.runtime, {
    lingerMs: 100,
    renderer: {
      render: (value) => {
        frame = value;
      },
    },
  });
  try {
    f.runtime.beginAgentActivity({ actor, summary: 'Counting the medalists.' }).end({ summary: '873 medalists.' });
    t.mock.timers.tick(1000);
    assert.deepEqual(presence.getSnapshot(), [], 'the live turn has retired');
    assert.equal(frame.activities[0]?.summary, '873 medalists.');
    assert.equal(frame.navigation?.canBack, false);
    frame.navigation!.close();
    assert.deepEqual(frame.activities, []);
  } finally {
    presence.dispose();
    f.runtime.dispose();
  }
});

test('steps sent in the same tick still move the cursor to the latest one', async () => {
  const lifetime = new AbortController();
  let publish!: (execution: VacpExecution) => void;
  const presence = createAgentPresence({
    signal: lifetime.signal,
    getProviderBinding: () => ({ id: 'binding', signal: lifetime.signal }),
    getAgentActivities: () => [],
    subscribeAgentActivities: () => () => {},
    getActiveExecutions: () => [],
    subscribeExecutions: (listener) => {
      publish = listener;
      return () => {};
    },
    subscribeSnapshots: () => () => {},
  });
  presence.attach(syntheticProvider('vacp-source://quick'), {
    resolve: (focus) => ({
      surface: 'test',
      precision: 'exact',
      geometry: { kind: 'point', point: { x: Number(focus.detail), y: 0 } },
    }),
  });
  for (const index of [1, 2, 3])
    publish({
      id: String(index),
      callId: String(index),
      sequence: index,
      name: 'focus',
      at: '',
      phase: 'prepared',
      actor: { id: 'agent', kind: 'agent' },
      sourceId: 'vacp-source://quick',
      bindingId: 'binding',
      intent: { affects: [], focus: { ref: 'vacp://plot', detail: index } },
    });
  await setImmediate();
  const [activity] = presence.getSnapshot();
  assert.equal(activity?.execution?.id, '3');
  assert.deepEqual(activity?.target?.geometry, { kind: 'point', point: { x: 3, y: 0 } });
  presence.dispose();
  lifetime.abort();
});

test('a step without a focus points at the first node it changes that its surface can place', async () => {
  const lifetime = new AbortController();
  let publish!: (execution: VacpExecution) => void;
  const presence = createAgentPresence({
    signal: lifetime.signal,
    getProviderBinding: () => ({ id: 'binding', signal: lifetime.signal }),
    getAgentActivities: () => [],
    subscribeAgentActivities: () => () => {},
    getActiveExecutions: () => [],
    subscribeExecutions: (listener) => {
      publish = listener;
      return () => {};
    },
    subscribeSnapshots: () => () => {},
  });
  // The surface places its plot and inputs, but has no single place for the view that holds them.
  const places: Record<string, number> = { 'vacp://plot': 1, 'vacp://input/blur': 2 };
  presence.attach(syntheticProvider('vacp-source://survey'), {
    resolve: (focus) =>
      places[focus.ref] === undefined
        ? null
        : { surface: 'test', precision: 'exact', geometry: { kind: 'point', point: { x: places[focus.ref]!, y: 0 } } },
  });
  const step = (id: string, sequence: number, intent: VacpExecution['intent']): VacpExecution => ({
    id,
    callId: id,
    sequence,
    name: id,
    at: '',
    phase: 'prepared',
    actor: { id: 'agent', kind: 'agent' },
    sourceId: 'vacp-source://survey',
    bindingId: 'binding',
    intent,
  });
  const pointedAt = async () => {
    await setImmediate();
    const geometry = presence.getSnapshot()[0]?.target?.geometry;
    return geometry?.kind === 'point' ? geometry.point.x : null;
  };
  try {
    publish(step('brush', 1, { affects: ['vacp://plot'], focus: { ref: 'vacp://plot' } }));
    assert.equal(await pointedAt(), 1);
    publish(step('apply', 2, { affects: ['vacp://view', 'vacp://input/blur', 'vacp://plot'] }));
    assert.equal(await pointedAt(), 2, 'the view has no place, so the first input it sets does');
    publish(step('reset', 3, { affects: ['vacp://view'] }));
    assert.equal(await pointedAt(), 2, 'with nothing it changes on screen, the cursor stays where it rested');
  } finally {
    presence.dispose();
    lifetime.abort();
  }
});

function watchedPresence() {
  const lifetime = new AbortController();
  let publish!: (execution: VacpExecution) => void;
  const presence = createAgentPresence(
    {
      signal: lifetime.signal,
      getProviderBinding: () => ({ id: 'binding', signal: lifetime.signal }),
      getAgentActivities: () => [],
      subscribeAgentActivities: () => () => {},
      getActiveExecutions: () => [],
      subscribeExecutions: (listener) => {
        publish = listener;
        return () => {};
      },
      subscribeSnapshots: () => () => {},
    },
    { lingerMs: 0 },
  );
  const surface = { watching: 0, started: 0 };
  const binding = (): PresencePresentation => ({
    resolve: () => ({ surface: 'test', precision: 'exact', geometry: { kind: 'point', point: { x: 1, y: 1 } } }),
    subscribe: () => {
      surface.watching++;
      surface.started++;
      return () => surface.watching--;
    },
  });
  const step = (id: string, phase: VacpExecution['phase']): VacpExecution => ({
    id,
    callId: id,
    sequence: 1,
    name: 'focus',
    at: '',
    phase,
    actor: { id: 'agent', kind: 'agent' },
    sourceId: 'vacp-source://watched',
    bindingId: 'binding',
    intent: { affects: [], focus: { ref: 'vacp://plot' } },
  });
  return {
    presence,
    surface,
    binding,
    provider: syntheticProvider('vacp-source://watched'),
    publish: (execution: VacpExecution) => publish(execution),
    step,
    dispose() {
      presence.dispose();
      lifetime.abort();
    },
  };
}

test('a surface is watched for layout only while a pointer rests on it', async () => {
  const f = watchedPresence();
  f.presence.attach(f.provider, f.binding());
  assert.equal(f.surface.watching, 0, 'nothing rests on the surface yet');
  f.publish(f.step('step', 'prepared'));
  await setImmediate();
  assert.equal(f.surface.watching, 1);
  f.publish(f.step('step', 'succeeded'));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(f.presence.getSnapshot().length, 0);
  assert.equal(f.surface.watching, 0, 'the pointer left, so the surface is no longer watched');
  f.dispose();
});

test('consecutive steps on one surface keep a single layout witness', async () => {
  const f = watchedPresence();
  f.presence.attach(f.provider, f.binding());
  f.publish(f.step('first', 'prepared'));
  f.publish(f.step('first', 'succeeded'));
  f.publish(f.step('second', 'prepared'));
  await setImmediate();
  assert.deepEqual(f.surface, { watching: 1, started: 1 });
  f.dispose();
});

test('a detach handle from an earlier attachment leaves the newer binding watched', async () => {
  const f = watchedPresence();
  const stale = f.presence.attach(f.provider, f.binding());
  stale();
  f.presence.attach(f.provider, f.binding());
  f.publish(f.step('step', 'prepared'));
  await setImmediate();
  stale();
  assert.equal(f.surface.watching, 1);
  assert.equal(f.presence.getSnapshot()[0]?.target?.precision, 'exact');
  f.dispose();
});
