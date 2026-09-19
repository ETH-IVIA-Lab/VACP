import assert from 'node:assert/strict';
import test from 'node:test';
import { VACP_SCHEMA_VERSION, type VacpFreshness } from '@vacp/protocol';
import { createVacpProvider, createVacpRuntime, VacpActionRegistry } from '@vacp/runtime';
import { createAgentPresence, paceAgentPresence, type PresenceActivity, type PresenceTarget } from '../src/index';

const target: PresenceTarget = {
  surface: 'test',
  precision: 'exact',
  geometry: { kind: 'point', point: { x: 10, y: 20 } },
};
function fixture() {
  const actions = new VacpActionRegistry();
  let executions = 0;
  let freshness: VacpFreshness = { status: 'running' };
  actions.register(
    { name: 'set', description: 'Set', operation: { kind: 'mutation', affects: ['vacp://plot'] } },
    () => ++executions,
    { parse: (value) => value, focus: (value) => ({ ref: 'vacp://plot', detail: value }) },
  );
  const provider = createVacpProvider({
    source: { id: 'vacp-source://test', type: 'test', title: 'Test' },
    actions,
    project: () => ({
      graph: {
        version: VACP_SCHEMA_VERSION,
        nodes: [{ ref: 'vacp://plot', kind: 'View', layer: 'ViewLayer' }],
        edges: [],
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

test('presence is independent of execution and distinguishes completion from freshness', async () => {
  const f = fixture();
  let rendered: readonly PresenceActivity[] = [];
  const countsAtResolution: number[] = [];
  const presence = createAgentPresence(f.runtime, {
    renderer: {
      render: (activities) => {
        rendered = activities;
      },
    },
  });
  presence.attach({
    ...f.runtime.getProviderBinding(f.provider),
    sourceId: f.provider.source.id,
    resolve: () => {
      countsAtResolution.push(f.count());
      return target;
    },
  });
  try {
    await f.runtime.execute({ callId: 'set', name: 'set' });
    assert.equal(f.count(), 1);
    assert.ok(countsAtResolution.length > 0 && countsAtResolution.every((count) => count === 1));
    assert.equal(rendered[0]!.execution.phase, 'succeeded');
    assert.equal(rendered[0]!.freshness, 'updating');
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

test('rapid actions keep every execution while late geometry cannot reclaim actor focus', async () => {
  const f = fixture();
  let finish!: (value: PresenceTarget) => void;
  const slow = new Promise<PresenceTarget>((resolve) => {
    finish = resolve;
  });
  const presence = createAgentPresence(f.runtime);
  presence.attach({
    ...f.runtime.getProviderBinding(f.provider),
    sourceId: f.provider.source.id,
    resolve: (focus) => (focus.detail === 0 ? slow : target),
  });
  try {
    for (let i = 0; i < 8; i++) await f.runtime.execute({ callId: String(i), name: 'set', params: i });
    finish({ ...target, geometry: { kind: 'point', point: { x: 99, y: 99 } } });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(f.count(), 8);
    assert.equal(presence.getSnapshot()[0]!.execution.callId, '7');
    assert.deepEqual(presence.getSnapshot()[0]!.target, target);
    f.runtime.removeProvider(f.provider.source.id);
    assert.deepEqual(presence.getSnapshot(), []);
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
    assert.equal(healthy.getSnapshot()[0]!.execution.callId, 'next');
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
  presence.attach({ ...lease, sourceId: f.provider.source.id, resolve: () => pending });
  try {
    await f.runtime.execute({ callId: 'old', name: 'set' });
    f.runtime.update({ providers: [{ ...f.provider }] });
    assert.equal(lease.signal.aborted, true);
    finish(target);
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(presence.getSnapshot(), []);
    await f.runtime.execute({ callId: 'replacement', name: 'set' });
    assert.equal(presence.getSnapshot()[0]!.target, null);
  } finally {
    presence.dispose();
    f.runtime.dispose();
  }
});

test('configured pauses bracket actual execution while the default path stays immediate', async () => {
  const f = fixture();
  const times = new Map<string, number>();
  f.runtime.subscribeExecutions((execution) => times.set(execution.phase, performance.now()));
  const presence = createAgentPresence(f.runtime);
  paceAgentPresence(f.runtime, presence, { arrivalTimeoutMs: 0, beforeExecuteMs: 40, afterExecuteMs: 50 });
  try {
    const result = await f.runtime.execute({ callId: 'paced', name: 'set' });
    const returned = performance.now();
    assert.equal(result.ok, true);
    assert.equal(f.count(), 1);
    assert.ok(times.get('running')! - times.get('prepared')! >= 35);
    assert.ok(returned - times.get('succeeded')! >= 45);
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
  presence.attach({
    ...f.runtime.getProviderBinding(f.provider),
    sourceId: f.provider.source.id,
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
    presence.attach({
      ...f.runtime.getProviderBinding(f.provider),
      sourceId: f.provider.source.id,
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
    subscribeExecutions: f.runtime.subscribeExecutions,
    subscribeSnapshots: f.runtime.subscribeSnapshots,
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
    assert.equal(first.getSnapshot()[0]!.execution.phase, 'succeeded');
    assert.equal(second.getSnapshot()[0]!.execution.phase, 'succeeded');
  } finally {
    remove();
    first.dispose();
    second.dispose();
    f.runtime.dispose();
  }
});
