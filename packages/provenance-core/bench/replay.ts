import type { VacpGraphFragment, VacpProvider } from '@ethivia/vacp-protocol';
import { createVacpRuntime } from '@ethivia/vacp-runtime';
import { measure } from '../../../tools/benchmark';
import { createProvenanceReplay } from '../src/index';

const size = 1_000;
const graph: VacpGraphFragment = {
  nodes: Array.from({ length: size }, (_, i) => ({ ref: `vacp://bench/${i}`, kind: 'Param', layer: 'ConfigLayer' })),
  edges: [],
  actions: [
    {
      name: 'set',
      description: 'Set the first parameter',
      operation: { kind: 'mutation', affects: ['vacp://bench/0'] },
      parameters: { type: 'object', properties: { value: { type: 'number' } } },
    },
  ],
};
let value = 0;
const provider: VacpProvider = {
  subscribe: () => () => {},
  source: { id: 'vacp-source://benchmark', type: 'benchmark', title: 'Replay benchmark' },
  observe: () => ({
    revision: String(value),
    observedAt: '',
    graph,
    state: Object.fromEntries(graph.nodes.map(({ ref }, i) => [ref, { value: i === 0 ? value : i }])),
  }),
  prepare: async (call) => ({
    intent: { affects: ['vacp://bench/0'] },
    execute: async () => {
      value++;
      return { callId: call.callId, ok: true };
    },
  }),
};

console.log(`Node ${process.version}; ${size}-node graph; full 256-record journal; one replay viewer`);
const runtime = createVacpRuntime({ providers: [provider] });
const replay = createProvenanceReplay(runtime, { restore: async () => ({ callId: 'restore', ok: true }) });
let steps = 0;
replay.subscribe(() => {
  steps = replay.getState().steps.length;
});
const execute = () => runtime.execute({ callId: `call-${value}`, name: 'set', params: {} });
try {
  for (let index = 0; index < 256; index++) await execute();
  await measure('recorded action with a replay viewer', execute, 50);
  await measure('journal read', () => runtime.getProvenance(), 50);
  console.log(`Checkpoints visible to the viewer: ${steps}`);
} finally {
  replay.dispose();
  runtime.dispose();
}
