import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { ProvenanceCheckpoint, ProvenanceReplayController, ProvenanceReplayState } from '@vacp/provenance-core';
import {
  VACP_SCHEMA_VERSION,
  type VacpActor,
  type VacpObservation,
  type VacpAgentActivity,
  type VacpTurnRecord,
} from '@vacp/protocol';
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
function turnRecord(activityId: string, message?: string, opening?: string): VacpTurnRecord {
  return {
    id: `turn-${activityId}`,
    at: '9',
    kind: 'turn',
    actor: { id: 'agent', kind: 'agent' },
    activityId,
    outcome: 'completed',
    message,
    opening,
  };
}

/** A recorded agent action of one request, with the state it produced. */
function actionCheckpoint(id: string, activityId: string, message: string, at = '5'): ProvenanceCheckpoint {
  const actor = { id: 'agent', kind: 'agent' } as const;
  return {
    id,
    position: 'after',
    observation,
    record: {
      id,
      at,
      kind: 'action',
      execution: {
        id,
        sequence: 1,
        callId: id,
        name: 'set',
        actor,
        activityId,
        narration: message,
        phase: 'succeeded',
        at,
      },
      call: { callId: id, name: 'set' },
      result: { callId: id, ok: true },
      observation,
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
  let state: ProvenanceReplayState = {
    phase: 'live',
    steps,
    turns: [],
    selected: null,
    working: false,
    latest: steps.at(-1)!,
  };
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
    // Like the runtime controller, the requested checkpoint is selected as restoring begins.
    review: async (id) => {
      visits.push(id);
      const selected = state.steps.find((step) => step.id === id)!;
      state = { ...state, phase: 'restoring', selected };
      changed();
      await Promise.resolve();
      state = { ...state, phase: 'reviewing', selected };
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
  let frames = 0;
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
          frames++;
        },
      },
    },
  );
  return {
    presence,
    visits,
    activity: (value: VacpAgentActivity) => activity(value),
    frame: () => frame,
    frames: () => frames,
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
  // The state before the first agent step is the trail's start; the person's step in between is not a frame.
  assert.deepEqual(f.frame().navigation?.frames, ['start', 'step', 'step']);
  assert.equal(f.frame().navigation?.index, 2);
  f.frame().navigation?.back();
  await setImmediate();
  assert.deepEqual(f.visits, ['one']);
  assert.equal(f.frame().navigation?.index, 1);
  f.frame().navigation?.back();
  await setImmediate();
  assert.deepEqual(f.visits, ['one', 'baseline']);
  assert.equal(f.frame().navigation?.index, 0);
  assert.equal(f.frame().navigation?.canBack, false);
  assert.equal(f.frame().activities[0]?.target, null, 'the start points at no single target');
  f.frame().navigation?.go(2);
  await setImmediate();
  assert.deepEqual(f.visits, ['one', 'baseline', 'two']);
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
  f.change({ phase: 'live', selected: null, working: false, steps: [initial], turns: [], latest: initial });
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
  f.change({ phase: 'live', selected: null, working: false, steps: [step], turns: [], latest: step });
  assert.equal(f.frame().activities[0]?.subject, 'Age distribution');
  f.presence.dispose();
});

test('a single recorded step stays on screen, dismissible, with no neighbours to step to', () => {
  const f = fixture();
  const only = checkpoint('only', 'agent');
  f.change({ phase: 'live', selected: null, working: false, steps: [only], turns: [], latest: only });
  assert.equal(f.frame().activities[0]?.summary, 'only');
  assert.equal(f.frame().activities[0]?.phase, 'completed');
  assert.equal(f.frame().navigation?.canBack, false);
  assert.equal(f.frame().navigation?.canForward, false);
  assert.deepEqual(f.frame().navigation?.frames, ['step']);
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
  assert.equal(f.frame().navigation?.index, -1);
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

test('a turn that answers without a step keeps its recorded answer until the person dismisses it', async () => {
  const f = fixture();
  const answer = turnRecord('question', 'The cohort has 873 medalists.');
  f.change({ ...f.state(), turns: [answer] });
  const frame = f.frame();
  assert.equal(frame.activities[0]?.summary, 'The cohort has 873 medalists.');
  assert.equal(frame.activities[0]?.recordId, answer.id);
  assert.deepEqual(frame.navigation?.frames, ['conclusion']);
  assert.equal(frame.navigation?.canBack, false);
  f.presence.invalidateTargets();
  await setImmediate();
  assert.equal(f.frame().activities[0]?.summary, 'The cohort has 873 medalists.');
  f.frame().navigation!.close();
  assert.deepEqual(f.frame().activities, []);
  f.presence.dispose();
});

test('a request steps from the state it began in, through each step, to its conclusion', async () => {
  const f = fixture();
  const before = checkpoint('before-request', 'human');
  const sex = actionCheckpoint('sex', 'request', 'Keeping only female athletes.');
  const sports = actionCheckpoint('sports', 'request', 'Comparing swimmers with gymnasts.');
  const ended = turnRecord(
    'request',
    'Female swimmers and gymnasts are in view.',
    'Filtering for female swimmers and gymnasts.',
  );
  f.change({
    phase: 'live',
    selected: null,
    working: false,
    steps: [before, sex, sports],
    turns: [ended],
    latest: sports,
  });
  const navigation = () => f.frame().navigation!;
  const words = () => f.frame().activities[0]?.summary;
  assert.deepEqual(navigation().frames, ['start', 'step', 'step', 'conclusion']);
  assert.equal(navigation().index, 3, 'after the request the conclusion is shown');
  assert.equal(words(), 'Female swimmers and gymnasts are in view.');
  assert.equal(f.frame().activities[0]?.target, null);
  navigation().back();
  await setImmediate();
  assert.equal(navigation().index, 2);
  assert.equal(words(), 'Comparing swimmers with gymnasts.');
  navigation().go(0);
  await setImmediate();
  assert.deepEqual(f.visits, ['sports', 'before-request']);
  assert.equal(navigation().index, 0);
  assert.equal(words(), 'Filtering for female swimmers and gymnasts.', "the start reads the request's opening words");
  assert.equal(f.frame().activities[0]?.phase, 'reviewing');
  // Forward to the conclusion leaves review, returning to the state the request left behind.
  navigation().go(3);
  await setImmediate();
  assert.equal(f.state().phase, 'live');
  assert.equal(navigation().index, 3);
  assert.equal(words(), 'Female swimmers and gymnasts are in view.');
  f.presence.dispose();
});

test('a request is shown on its own, and a newer request replaces it once it records a step', () => {
  const f = fixture();
  const first = actionCheckpoint('first', 'earlier', 'Keeping only female athletes.');
  const earlier = turnRecord('earlier', 'Female athletes are in view.');
  const second = actionCheckpoint('second', 'later', 'Narrowing the ages.', '99');
  f.change({ phase: 'live', selected: null, working: false, steps: [first], turns: [earlier], latest: first });
  assert.deepEqual(f.frame().navigation?.frames, ['step', 'conclusion']);
  f.change({ phase: 'live', selected: null, working: false, steps: [first, second], turns: [earlier], latest: second });
  assert.deepEqual(f.frame().navigation?.frames, ['start', 'step'], 'the new request starts where the last one ended');
  assert.equal(f.frame().activities[0]?.summary, 'Narrowing the ages.');
  f.presence.dispose();
});

test('the frame asked for is shown busy from the moment it is requested until it is restored', async () => {
  const f = fixture();
  const index = f.frame().navigation!.index;
  f.frame().navigation!.back();
  assert.equal(f.frame().navigation?.index, index - 1);
  assert.equal(f.frame().navigation?.restoring, true);
  assert.equal(f.frame().activities[0]?.summary, 'one');
  await setImmediate();
  assert.equal(f.frame().navigation?.restoring, false);
  assert.equal(f.frame().navigation?.index, index - 1);
  f.presence.dispose();
});

test('a new request recorded in the same millisecond as the previous turn is the one shown', () => {
  const f = fixture();
  const first = actionCheckpoint('first', 'earlier', 'Keeping only female athletes.', '7');
  const earlier = { ...turnRecord('earlier', 'Female athletes are in view.'), at: '7' };
  const second = actionCheckpoint('second', 'later', 'Narrowing the ages.', '7');
  f.change({ phase: 'live', selected: null, working: false, steps: [first, second], turns: [earlier], latest: second });
  assert.deepEqual(f.frame().navigation?.frames, ['start', 'step']);
  assert.equal(f.frame().activities[0]?.summary, 'Narrowing the ages.');
  f.presence.dispose();
});

test('an event that changes nothing on screen draws no new frame', () => {
  const f = fixture();
  const drawn = f.frames();
  f.change({ ...f.state() });
  f.activity({ id: 'idle', actor: { id: 'human', kind: 'human' }, phase: 'completed', at: '' });
  assert.equal(f.frames(), drawn);
  f.presence.dispose();
});

test('stepping waits while live work is in flight and resumes when it finishes', async () => {
  const f = fixture();
  f.change({ ...f.state(), working: true });
  const waiting = f.frame().navigation!;
  assert.equal(waiting.working, true);
  assert.equal(waiting.canBack, false);
  waiting.back();
  await setImmediate();
  assert.deepEqual(f.visits, [], 'a step asked for during live work is not taken');
  f.change({ ...f.state(), working: false });
  assert.equal(f.frame().navigation?.canBack, true);
  f.frame().navigation!.back();
  await setImmediate();
  assert.deepEqual(f.visits, ['one']);
  f.presence.dispose();
});

test('an open agent turn holds stepping until the agent finishes', async () => {
  const f = fixture();
  const turn: VacpAgentActivity = {
    id: 'turn',
    actor: { id: 'agent', kind: 'agent' },
    phase: 'thinking',
    summary: 'Comparing',
    at: '',
  };
  f.activity(turn);
  assert.equal(f.frame().navigation?.working, true);
  f.frame().navigation?.back();
  await setImmediate();
  assert.deepEqual(f.visits, []);
  f.activity({ ...turn, phase: 'completed', summary: 'Done' });
  assert.equal(f.frame().navigation?.working, false);
  assert.equal(f.frame().navigation?.canBack, true);
  f.presence.dispose();
});
