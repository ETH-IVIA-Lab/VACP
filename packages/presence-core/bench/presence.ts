import { setImmediate } from 'node:timers/promises';
import type { VacpExecution } from '@vacp/protocol';
import { createAgentPresence, type PresenceSource } from '../src/index';
import { measure } from '../../../tools/benchmark';

const points = Array.from({ length: 10_000 }, (_, id) => ({ id, x: id % 100, y: Math.floor(id / 100) }));
const size = 200;
let resolutions = 0;
async function burst() {
  resolutions = 0;
  const lifetime = new AbortController();
  let publish!: (event: VacpExecution) => void;
  const source: PresenceSource = {
    signal: lifetime.signal,
    subscribeExecutions: (listener) => {
      publish = listener;
      return () => {};
    },
    subscribeSnapshots: () => () => {},
  };
  const presence = createAgentPresence(source);
  presence.attach({
    id: 'binding',
    sourceId: 'vacp-source://benchmark',
    signal: lifetime.signal,
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
    if (activity?.execution.callId !== String(size - 1) || !activity.target)
      throw new Error('Latest focus was not resolved');
  } finally {
    presence.dispose();
    lifetime.abort();
  }
}
console.log(`Node ${process.version}; ${size} coalesced executions; 10,000-mark resolver`);
await measure('Presence burst', burst, 20);
console.log(`Resolver invocations per burst: ${resolutions}`);
