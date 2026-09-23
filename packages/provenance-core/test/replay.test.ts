import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type {
  VacpActor,
  VacpExecution,
  VacpObservation,
  VacpProvenanceEvent,
  VacpProvenanceRecord,
} from '@vacp/protocol';
import {
  createProvenanceReplay,
  provenanceActor,
  provenanceCheckpoints,
  type ProvenanceCheckpoint,
  type ProvenanceReplayOptions,
} from '../src/index';

const agent: VacpActor = { id: 'agent', kind: 'agent' };
const human: VacpActor = { id: 'human', kind: 'human' };
const system: VacpActor = { id: 'system', kind: 'system' };
function observation(value: number): VacpObservation {
  return {
    version: '0.1.0',
    revision: String(value),
    observedAt: '2026-09-22T00:00:00.000Z',
    graph: { version: '0.1.0', sources: [], ownership: { nodes: {}, actions: {} }, nodes: [], edges: [], actions: [] },
    state: { 'vacp://value': value },
  };
}
function captured(id: string, value: number, actor = agent): VacpProvenanceRecord {
  return {
    id,
    at: '2026-09-22T00:00:00.000Z',
    kind: 'observation',
    cause: { kind: 'external' },
    actor,
    observation: observation(value),
  };
}
function fixture() {
  const lifetime = new AbortController();
  const records: VacpProvenanceRecord[] = [];
  const recordingListeners = new Set<(event: VacpProvenanceEvent) => void>();
  const executionListeners = new Set<(execution: VacpExecution) => void>();
  let value = 0,
    epoch = 0,
    revision = 0;
  const source = {
    signal: lifetime.signal,
    getActiveExecutions: (): readonly VacpExecution[] => [],
    inspect: () => observation(value),
    getProvenance: () => ({ runtimeId: 'test', epoch, revision, limit: 256, records: structuredClone(records) }),
    subscribeProvenance(listener: (event: VacpProvenanceEvent) => void) {
      recordingListeners.add(listener);
      return () => {
        recordingListeners.delete(listener);
      };
    },
    subscribeExecutions(listener: (execution: VacpExecution) => void) {
      executionListeners.add(listener);
      return () => {
        executionListeners.delete(listener);
      };
    },
  };
  const emit = (record: VacpProvenanceRecord | null) => {
    revision++;
    for (const listener of recordingListeners) listener({ epoch, revision, record });
  };
  const record = (next: number, actor = agent) => {
    value = next;
    const entry = captured(String(++revision), next, actor);
    records.push(entry);
    emit(entry);
  };
  const restore: ProvenanceReplayOptions['restore'] = async (next, options) => {
    value = Number(next.state['vacp://value']);
    const entry: VacpProvenanceRecord = {
      ...captured(String(++revision), value, human),
      kind: 'observation',
      observation: next,
      actor: human,
      cause: { kind: 'concurrent', executions: [{ executionId: 'restoring', restoration: options.restoration }] },
    };
    records.push(entry);
    emit(entry);
    return { callId: 'restore', ok: true, result: undefined };
  };
  return {
    source,
    evidence: (record: VacpProvenanceRecord) => {
      records.push(record);
      emit(record);
    },
    execution: (execution: VacpExecution) => {
      for (const listener of executionListeners) listener(execution);
    },
    record,
    restore,
    value: () => value,
    subscriptions: () => recordingListeners.size + executionListeners.size,
    reset() {
      epoch++;
      records.length = 0;
      value = 0;
      emit(null);
    },
    dispose: () => lifetime.abort(),
  };
}

test('chronology retains agent A, human B, agent A before actor projection', () => {
  const steps = provenanceCheckpoints([captured('one', 1), captured('two', 2, human), captured('three', 1)]);
  assert.deepEqual(
    steps.filter((step) => provenanceActor(step.record).kind === 'agent').map((step) => step.id),
    ['one', 'three'],
  );
});

test('captured partial failures remain checkpoints while query and restoration do not', () => {
  const execution = {
    id: 'execution',
    sequence: 1,
    callId: 'call',
    name: 'change',
    actor: agent,
    phase: 'failed' as const,
    at: 'now',
    operationKind: 'mutation' as const,
  };
  const entry: VacpProvenanceRecord = {
    id: 'partial',
    at: 'now',
    kind: 'action',
    execution,
    call: { callId: 'call', name: 'change' },
    result: { callId: 'call', ok: false, error: { message: 'Second source failed' } },
    before: observation(0),
    observation: observation(1),
  };
  const steps = provenanceCheckpoints([
    entry,
    { ...entry, id: 'query', execution: { ...execution, operationKind: 'query' } },
    { ...entry, id: 'restore', execution: { ...execution, restoration: { id: 'viewer' } } },
  ]);
  assert.deepEqual(
    steps.map((step) => [step.id, step.position]),
    [
      ['partial:before', 'before'],
      ['partial', 'after'],
    ],
  );
});

test('nonlinear review restores real checkpoints and close returns to the saved live view', async (t) => {
  const f = fixture();
  t.after(f.dispose);
  f.record(1);
  f.record(2, human);
  f.record(3);
  const replay = createProvenanceReplay(f.source, { restore: f.restore });
  t.after(replay.dispose);
  const steps = replay.getState().steps;
  await replay.review(steps[0]!.id);
  assert.equal(f.value(), 1);
  await replay.review(steps[1]!.id);
  assert.equal(f.value(), 2);
  assert.equal(replay.getState().selected?.record.kind, 'observation');
  await replay.close();
  assert.equal(f.value(), 3);
  assert.equal(replay.getState().phase, 'live');
  assert.equal(replay.getState().steps.length, 3);
});

test('unattributed external changes interrupt review and prevent stale baseline restoration', async (t) => {
  const f = fixture();
  t.after(f.dispose);
  f.record(1);
  f.record(2);
  const replay = createProvenanceReplay(f.source, { restore: f.restore });
  t.after(replay.dispose);
  await replay.review(replay.getState().steps[0]!.id);
  f.record(9, system);
  assert.equal(replay.getState().phase, 'live');
  await replay.close();
  assert.equal(f.value(), 9);
});

test('an epoch reset during baseline capture cancels navigation without hydrating stale records', async (t) => {
  const f = fixture();
  t.after(f.dispose);
  f.record(1);
  f.record(2);
  let finish!: (value: VacpObservation) => void;
  const replay = createProvenanceReplay(
    {
      ...f.source,
      inspect: () =>
        new Promise<VacpObservation>((resolve) => {
          finish = resolve;
        }),
    },
    { restore: f.restore },
  );
  t.after(replay.dispose);
  const pending = replay.review(replay.getState().steps[0]!.id);
  await setImmediate();
  f.reset();
  await pending;
  finish(observation(2));
  await setImmediate();
  assert.equal(replay.getState().phase, 'live');
  assert.equal(replay.getState().steps.length, 0);
  assert.equal(f.value(), 0);
});

test('failed restoration can be retried and an external change cancels the pending retry', async (t) => {
  const f = fixture();
  t.after(f.dispose);
  f.record(1);
  f.record(2);
  let signal: AbortSignal | undefined;
  let attempts = 0;
  const replay = createProvenanceReplay(f.source, {
    restore: (_, options) => {
      if (++attempts === 1)
        return Promise.resolve({ callId: 'fail', ok: false, error: { message: 'Source unavailable' } });
      signal = options.signal;
      return new Promise(() => {});
    },
  });
  t.after(replay.dispose);
  const checkpoint = replay.getState().steps[0]!.id;
  await replay.review(checkpoint);
  assert.equal(replay.getState().phase, 'error');
  assert.equal(replay.getState().error, 'Source unavailable');
  const pending = replay.review(checkpoint);
  await setImmediate();
  assert.equal(replay.getState().phase, 'restoring');
  f.record(8, human);
  await pending;
  assert.equal(signal?.aborted, true);
  assert.equal(replay.getState().phase, 'live');
  await replay.close();
  assert.equal(f.value(), 8);
  replay.dispose();
  assert.equal(f.subscriptions(), 0);
});

test('replay exposes every retained checkpoint through a stable frozen view', () => {
  const f = fixture();
  for (let i = 0; i < 300; i++) f.record(i);
  const replay = createProvenanceReplay(f.source, { restore: f.restore });
  const state = replay.getState();
  assert.equal(state.steps.length, 300);
  assert.equal(replay.getState(), state, 'an unchanged view keeps its identity for external stores');
  assert.throws(() => {
    (state.steps as ProvenanceCheckpoint[]).pop();
  }, TypeError);
  assert.throws(() => {
    (state.steps[0] as { id: string }).id = 'tampered';
  }, TypeError);
  f.record(300);
  assert.notEqual(replay.getState(), state);
  assert.equal(replay.getState().steps.length, 301);
  replay.dispose();
  f.dispose();
});

test('another viewer restoration interrupts review before its effects', async (t) => {
  const f = fixture();
  t.after(f.dispose);
  f.record(1);
  f.record(2);
  const replay = createProvenanceReplay(f.source, { restore: f.restore });
  t.after(replay.dispose);
  await replay.review(replay.getState().steps[0]!.id);
  f.execution({
    id: 'other',
    sequence: 1,
    callId: 'other',
    name: 'restore',
    actor: human,
    phase: 'prepared',
    at: 'now',
    operationKind: 'mutation',
    restoration: { id: 'other-viewer' },
  });
  assert.equal(replay.getState().phase, 'live');
  await replay.close();
  assert.equal(f.value(), 1);
  replay.dispose();
});

test('failed subscription setup releases previously acquired recording subscriptions', (t) => {
  const f = fixture();
  t.after(f.dispose);
  assert.throws(
    () =>
      createProvenanceReplay(
        {
          ...f.source,
          subscribeExecutions: () => {
            throw new Error('Unavailable');
          },
        },
        { restore: f.restore },
      ),
    /Unavailable/,
  );
  assert.equal(f.subscriptions(), 0);
});

test('a late viewer waits for already active mutations before restoring a checkpoint', async (t) => {
  const f = fixture();
  t.after(f.dispose);
  f.record(1);
  f.record(2);
  const active: VacpExecution = {
    id: 'active',
    sequence: 1,
    callId: 'active',
    name: 'change',
    actor: agent,
    phase: 'running',
    at: 'now',
    operationKind: 'mutation',
  };
  const replay = createProvenanceReplay({ ...f.source, getActiveExecutions: () => [active] }, { restore: f.restore });
  t.after(replay.dispose);
  const checkpoint = replay.getState().steps[0]!;
  await replay.review(checkpoint.id);
  assert.equal(f.value(), 2);
  f.execution({ ...active, phase: 'succeeded' });
  await replay.review(checkpoint.id);
  assert.equal(f.value(), 1);
});

test('concurrent evidence stays in recording without masking terminal checkpoints or interrupting own restore', async (t) => {
  const f = fixture();
  t.after(f.dispose);
  f.record(1);
  f.record(2);
  const replay = createProvenanceReplay(f.source, {
    restore: async (observation, options) => {
      f.evidence({
        ...captured('intermediate', 8, system),
        kind: 'observation',
        actor: system,
        observation: observation,
        cause: { kind: 'concurrent', executions: [{ executionId: 'own', restoration: options.restoration }] },
      });
      return f.restore(observation, options);
    },
  });
  t.after(replay.dispose);
  await replay.review(replay.getState().steps[0]!.id);
  assert.equal(replay.getState().phase, 'reviewing');
  assert.equal(replay.getState().steps.length, 2);
  assert(f.source.getProvenance().records.some((record) => record.id === 'intermediate'));
  assert.equal(provenanceCheckpoints(f.source.getProvenance().records).length, 2);
});

test('explicit host input intent abandons pending restoration and never rolls back the new live view', async (t) => {
  const f = fixture();
  t.after(f.dispose);
  f.record(1);
  f.record(2);
  let signal: AbortSignal | undefined;
  let calls = 0;
  const replay = createProvenanceReplay(f.source, {
    restore: (_, options) => {
      calls++;
      signal = options.signal;
      return new Promise(() => {});
    },
  });
  t.after(replay.dispose);
  const pending = replay.review(replay.getState().steps[0]!.id);
  await setImmediate();
  replay.interrupt();
  await pending;
  assert.equal(signal?.aborted, true);
  assert.equal(replay.getState().phase, 'live');
  f.record(8, human);
  await replay.close();
  assert.equal(calls, 1);
  assert.equal(f.value(), 8);
});

test('rejected operations without a pre-effect checkpoint do not invent analytical steps', () => {
  const record: VacpProvenanceRecord = {
    id: 'rejected',
    at: 'now',
    kind: 'action',
    execution: {
      id: 'rejected',
      sequence: 1,
      callId: 'rejected',
      name: 'unknown',
      actor: agent,
      phase: 'failed',
      at: 'now',
    },
    call: { callId: 'rejected', name: 'unknown' },
    result: { callId: 'rejected', ok: false, error: { message: 'Unknown action' } },
    observation: observation(0),
  };
  assert.deepEqual(provenanceCheckpoints([record]), []);
  assert.deepEqual(
    provenanceCheckpoints([{ ...record, execution: { ...record.execution, operationKind: 'mutation' } }]),
    [],
  );
});
