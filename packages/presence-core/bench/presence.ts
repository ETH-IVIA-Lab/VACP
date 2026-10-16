import { createVacpProvider, VacpActionRegistry } from '@vacp/runtime';
import { setImmediate } from 'node:timers/promises';
import type { VacpExecution, VacpSourceId } from '@vacp/protocol';
import { createAgentPresence, type PresenceSource } from '../src/index';
import { measure } from '../../../tools/benchmark';

function benchmarkProvider(id: VacpSourceId) {
  return createVacpProvider({
    source: { id, type: 'benchmark', title: 'Benchmark' },
    actions: new VacpActionRegistry(),
    project: () => ({ graph: { nodes: [], edges: [], actions: [] }, state: {} }),
    subscribe: () => () => {},
  });
}

const points = Array.from({ length: 10_000 }, (_, id) => ({ id, x: id % 100, y: Math.floor(id / 100) }));
const size = 200;
let resolutions = 0;
async function burst() {
  resolutions = 0;
  const lifetime = new AbortController();
  let publish!: (event: VacpExecution) => void;
  const source: PresenceSource = {
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
  };
  const presence = createAgentPresence(source);
  presence.attach(benchmarkProvider('vacp-source://benchmark'), {
    resolve: (focus) => {
      resolutions++;
      const point = points.find((point) => point.id === focus.detail)!;
      return { surface: 'benchmark', precision: 'exact', geometry: { kind: 'point', point } };
    },
  });
  try {
    for (let index = 0; index < size; index++)
      publish({
        id: String(index),
        callId: String(index),
        sequence: index,
        name: 'focus',
        at: '',
        phase: 'prepared',
        actor: { id: 'agent', kind: 'agent' },
        sourceId: 'vacp-source://benchmark',
        bindingId: 'binding',
        intent: { affects: [], focus: { ref: 'vacp://plot', detail: points.length - 1 } },
      });
    await setImmediate();
    const activity = presence.getSnapshot()[0];
    if (activity?.execution!.callId !== String(size - 1) || !activity.target)
      throw new Error('Latest focus was not resolved');
  } finally {
    presence.dispose();
    lifetime.abort();
  }
}
console.log(`Node ${process.version}; ${size} coalesced executions; 10,000-mark resolver`);
await measure('Presence burst', burst, 20);
console.log(`Resolver invocations per burst: ${resolutions}`);

// Streaming text with a retained spatial intent should not recopy its large geometry each token.
let progress!: (event: import('@vacp/protocol').VacpAgentActivity) => void;
let execution!: (event: VacpExecution) => void;
const streamingSource: PresenceSource = {
  signal: new AbortController().signal,
  getProviderBinding: () => ({ id: 'stream-binding', signal: streamingSource.signal }),
  getActiveExecutions: () => [],
  getAgentActivities: () => [],
  subscribeExecutions: (listener) => {
    execution = listener;
    return () => {};
  },
  subscribeAgentActivities: (listener) => {
    progress = listener;
    return () => {};
  },
  subscribeSnapshots: () => () => {},
};
const streamed = createAgentPresence(streamingSource, { renderer: { render: () => {} } });
streamed.subscribe(() => {});
streamed.attach(benchmarkProvider('vacp-source://stream'), {
  resolve: () => ({ surface: 'benchmark', precision: 'exact', geometry: { kind: 'path', points } }),
});
const activity = { id: 'work', actor: { id: 'agent', kind: 'agent' as const }, phase: 'thinking' as const, at: '' };
progress({ ...activity, summary: 'Comparing rows' });
execution({
  id: 'step',
  callId: 'step',
  sequence: 1,
  name: 'select',
  at: '',
  phase: 'prepared',
  actor: activity.actor,
  sourceId: 'vacp-source://stream',
  bindingId: 'stream-binding',
  intent: { affects: [], focus: { ref: 'vacp://plot' } },
});
await setImmediate();
await measure(
  'Presence text with 10,000-point target and subscriber',
  () => {
    for (let index = 0; index < 50; index++) progress({ ...activity, summary: `Comparing ${index} rows` });
  },
  5,
);
streamed.dispose();
