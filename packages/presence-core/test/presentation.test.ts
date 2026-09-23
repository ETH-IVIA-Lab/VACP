import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { ProvenanceCheckpoint, ProvenanceReplayController, ProvenanceReplayState } from '@vacp/provenance-core';
import { VACP_SCHEMA_VERSION, type VacpActor, type VacpObservation, type VacpAgentActivity } from '@vacp/protocol';
import { createAgentPresence, type PresenceFrame } from '../src/index';

const observation: VacpObservation = {
  version: VACP_SCHEMA_VERSION,
  revision: '1',
  observedAt: '',
  graph: {
    version: VACP_SCHEMA_VERSION,
    nodes: [],
    edges: [],
    actions: [],
    sources: [],
    ownership: { nodes: { 'vacp://plot': 'vacp-source://test' }, actions: {} },
  },
  state: {},
};
function checkpoint(
  id: string,
  kind: VacpActor['kind'],
  position: 'before' | 'after' = 'after',
  seen: VacpObservation = observation,
): ProvenanceCheckpoint {
  return {
    id,
    position,
    observation: seen,
    record: {
      id,
      at: '',
      kind: 'observation',
      cause: { kind: 'external' },
      actor: { id: kind, kind },
      observation: seen,
      focus: { ref: 'vacp://plot' },
      message: id,
    },
  };
}
function fixture() {
  const steps = [
    checkpoint('baseline', 'agent', 'before'),
    checkpoint('one', 'agent'),
    checkpoint('human', 'human'),
    checkpoint('two', 'agent'),
  ];
  let state: ProvenanceReplayState = { phase: 'live', steps, selected: null, latest: steps.at(-1)! };
  let changed = () => {};
  const visits: string[] = [];
  let disposed = false;
  const replay: ProvenanceReplayController = {
    getState: () => state,
    subscribe: (listener) => {
      changed = listener;
      return () => {
        changed = () => {};
      };
    },
    review: async (id) => {
      visits.push(id);
      state = { ...state, phase: 'reviewing', selected: steps.find((step) => step.id === id)! };
      changed();
    },
    interrupt: () => {
      state = { ...state, phase: 'live', selected: null };
      changed();
    },
    close: async () => {
      state = { ...state, phase: 'live', selected: null };
      changed();
    },
    dispose: () => {
      disposed = true;
    },
  };
  let activity = (_value: VacpAgentActivity) => {};
  let frame: PresenceFrame = { activities: [], reason: 'activity' };
  const presence = createAgentPresence(
    {
      signal: new AbortController().signal,
      getActiveExecutions: () => [],
      subscribeExecutions: () => () => {},
      subscribeSnapshots: () => () => {},
      getAgentActivities: () => [],
      subscribeAgentActivities: (listener) => {
        activity = listener;
        return () => {};
      },
    },
    {
      replay,
      renderer: {
        render: (value) => {
          frame = value;
        },
      },
    },
  );
  return {
    presence,
    visits,
    activity: (value: VacpAgentActivity) => activity(value),
    frame: () => frame,
    disposed: () => disposed,
    change: (next: ProvenanceReplayState) => {
      state = next;
      changed();
    },
    state: () => state,
  };
}

test('presence derives agent-only navigation from complete independent provenance', async () => {
  const f = fixture();
  assert.equal(f.frame().activities[0]?.summary, 'two');
  f.frame().navigation?.back();
  await setImmediate();
  assert.deepEqual(f.visits, ['one']);
  assert.equal(f.frame().navigation?.canBack, false);
  assert.equal(f.frame().navigation?.canForward, true);
  f.frame().navigation?.forward();
  await setImmediate();
  assert.deepEqual(f.visits, ['one', 'two']);
  assert.equal(f.frame().activities[0]?.phase, 'reviewing');
  f.presence.dispose();
  assert.equal(f.disposed(), false, 'presence does not own the replay controller');
});

test('retained and replay targets use the attached provider binding and refresh on layout', async () => {
  const f = fixture();
  let x = 10;
  const detach = f.presence.attach({
    sourceId: 'vacp-source://test',
    id: 'generation',
    signal: new AbortController().signal,
    resolve: () => ({ surface: 'test', precision: 'exact', geometry: { kind: 'point', point: { x, y: 20 } } }),
  });
  await setImmediate();
  assert.equal(f.frame().activities[0]?.target?.geometry.kind, 'point');
  x = 100;
  f.presence.invalidateTargets();
  await setImmediate();
  assert.deepEqual(f.frame().activities[0]?.target?.geometry, { kind: 'point', point: { x: 100, y: 20 } });
  detach();
  await setImmediate();
  assert.equal(f.frame().activities[0]?.target, null);
  f.presence.dispose();
});

test('agent progress supersedes older checkpoints and later human edits retire retained presence', () => {
  const f = fixture();
  const initial = checkpoint('initial-view', 'system');
  f.change({ phase: 'live', selected: null, steps: [initial], latest: initial });
  const work: VacpAgentActivity = {
    id: 'host-turn',
    actor: { id: 'writer', kind: 'agent' },
    phase: 'thinking',
    at: '',
    summary: 'Comparing athletes',
  };
  f.activity(work);
  f.presence.invalidateTargets();
  f.activity({ ...work, phase: 'completed', summary: 'The comparison is ready' });
  assert.equal(f.frame().activities[0]?.summary, 'The comparison is ready');
  assert.equal(f.frame().activities[0]?.phase, 'completed');
  // The runtime's own observation after the agent's change is not a person taking over.
  const observed = checkpoint('observed-drift', 'system');
  f.change({ ...f.state(), steps: [initial, observed], latest: observed });
  assert.equal(f.frame().activities[0]?.summary, 'The comparison is ready');
  const manual = checkpoint('manual-change', 'human');
  f.change({ ...f.state(), steps: [initial, observed, manual], latest: manual });
  assert.deepEqual(f.frame().activities, []);
  assert.equal(f.state().steps.at(-1)?.id, 'manual-change');
  f.presence.dispose();
});

test('dismissing the retained step hides the trail until the agent starts new work', async () => {
  const f = fixture();
  assert.equal(f.frame().activities[0]?.summary, 'two');
  assert.equal(f.frame().navigation?.reviewing, false);
  f.frame().navigation!.close();
  assert.deepEqual(f.frame().activities, []);
  f.presence.invalidateTargets();
  await setImmediate();
  assert.deepEqual(f.frame().activities, [], 'layout refreshes keep the trail dismissed');
  const work: VacpAgentActivity = {
    id: 'turn',
    actor: { id: 'agent', kind: 'agent' },
    phase: 'thinking',
    summary: 'Looking again',
    at: '',
  };
  f.activity(work);
  assert.equal(f.frame().activities[0]?.summary, 'Looking again');
  f.presence.dispose();
});

test('leaving review dismisses the trail instead of reopening the latest step', async () => {
  const f = fixture();
  f.frame().navigation!.back();
  await setImmediate();
  assert.equal(f.frame().activities[0]?.phase, 'reviewing');
  f.frame().navigation!.close();
  f.change({ ...f.state(), phase: 'live', selected: null });
  assert.deepEqual(f.frame().activities, []);
  f.presence.dispose();
});

test('a recorded step is labelled by the view containing its focus, even through a containment cycle', () => {
  const seen: VacpObservation = {
    ...observation,
    graph: {
      ...observation.graph,
      edges: [
        { from: 'vacp://app/age', to: 'vacp://plot', kind: 'contains' },
        { from: 'vacp://app', to: 'vacp://app/age', kind: 'contains' },
        // A malformed provider graph may contain itself; labelling must still finish.
        { from: 'vacp://loop', to: 'vacp://app', kind: 'contains' },
        { from: 'vacp://app', to: 'vacp://loop', kind: 'contains' },
      ],
      nodes: [
        { ref: 'vacp://app', kind: 'App', layer: 'ViewLayer', title: 'Athletes' },
        { ref: 'vacp://app/age', kind: 'Visualization', layer: 'VisualizationLayer', title: 'Age distribution' },
        { ref: 'vacp://plot', kind: 'Interactor', layer: 'InteractionLayer', title: 'Interval X' },
      ],
    },
  };
  const f = fixture();
  const step = checkpoint('labelled', 'agent', 'after', seen);
  f.change({ phase: 'live', selected: null, steps: [step], latest: step });
  assert.equal(f.frame().activities[0]?.subject, 'Age distribution');
  f.presence.dispose();
});

test('a single recorded step stays on screen, dismissible, with no neighbours to step to', () => {
  const f = fixture();
  const only = checkpoint('only', 'agent');
  f.change({ phase: 'live', selected: null, steps: [only], latest: only });
  assert.equal(f.frame().activities[0]?.summary, 'only');
  assert.equal(f.frame().activities[0]?.phase, 'completed');
  assert.equal(f.frame().navigation?.canBack, false);
  assert.equal(f.frame().navigation?.canForward, false);
  assert.deepEqual(f.frame().navigation?.position, { index: 1, count: 1 });
  f.frame().navigation!.close();
  assert.deepEqual(f.frame().activities, []);
  f.presence.dispose();
});

test("a checkpoint selected outside this viewer's trail shows nothing and offers no step from it", () => {
  const f = fixture();
  const human = f.state().steps.find((step) => step.id === 'human')!;
  f.change({ ...f.state(), phase: 'reviewing', selected: human });
  assert.deepEqual(f.frame().activities, []);
  assert.equal(f.frame().navigation?.canBack, false);
  assert.equal(f.frame().navigation?.canForward, false);
  assert.ok(f.frame().navigation!.position.index >= 1);
  f.presence.dispose();
});

test("a person's change hides the trail until the agent records again, whatever the runtime observes meanwhile", () => {
  const f = fixture();
  assert.equal(f.frame().activities[0]?.summary, 'two');
  const manual = checkpoint('manual', 'human');
  f.change({ ...f.state(), steps: [...f.state().steps, manual], latest: manual });
  assert.deepEqual(f.frame().activities, []);
  const drift = checkpoint('drift', 'system');
  f.change({ ...f.state(), steps: [...f.state().steps, drift], latest: drift });
  assert.deepEqual(f.frame().activities, [], 'a system observation is not the agent coming back');
  const three = checkpoint('three', 'agent');
  f.change({ ...f.state(), steps: [...f.state().steps, three], latest: three });
  assert.equal(f.frame().activities[0]?.summary, 'three');
  f.presence.dispose();
});
