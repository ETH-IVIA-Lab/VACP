import { measure } from '../../../tools/benchmark';
import {
  VACP_SCHEMA_VERSION,
  fnv1a64Hex,
  stableStringify,
  type VacpGraphFragment,
  type VacpProvider,
} from '@vacp/protocol';
import { composeVacpProviders, createVacpRuntime } from '../src/index';

const size = 1_000;
const graph: VacpGraphFragment = {
  version: VACP_SCHEMA_VERSION,
  nodes: Array.from({ length: size }, (_, i) => ({
    ref: `vacp://bench/${i}`,
    kind: 'Param',
    layer: 'ConfigLayer',
    title: `Parameter ${i}`,
  })),
  edges: [],
  actions: Array.from({ length: size }, (_, i) => ({
    name: `set.${i}`,
    description: `Set parameter ${i}`,
    operation: { kind: 'mutation', affects: [`vacp://bench/${i}`] },
    parameters: { type: 'object', properties: { value: { type: 'number' } } },
  })),
};
const state = Object.fromEntries(graph.nodes.map(({ ref }, i) => [ref, { value: i, selected: false }]));
const provider: VacpProvider = {
  source: { id: 'vacp-source://benchmark', type: 'benchmark', title: 'Runtime benchmark' },
  observe: () => ({ revision: 'static', observedAt: '', graph, state }),
  prepare: async (call) => ({ intent: { affects: [] }, execute: async () => ({ callId: call.callId, ok: true }) }),
};

console.log(`Node ${process.version}; ${size} nodes/actions/state refs; static provider`);
await measure('hash 100 KiB', () => fnv1a64Hex('x'.repeat(100 * 1024)));
const runtime = createVacpRuntime({ providers: [provider] });
try {
  await measure('capabilities without subscribers', () => runtime.getCapabilities());
  await measure('full state update', () => runtime.getState({ mode: 'full' }));
  const initial = await runtime.getState({ mode: 'full' });
  await measure('unchanged delta', () => runtime.getState({ mode: 'delta', since: initial.token }));
  const unsubscribe = runtime.subscribeSnapshots(() => {});
  runtime.stopObserving();
  await measure('unchanged subscribed snapshot', () => runtime.getCapabilities());
  unsubscribe();
} finally {
  runtime.dispose();
}
console.log(`State payload: ${stableStringify({ state }).length} UTF-16 code units`);

const linkedGraph: VacpGraphFragment = {
  ...graph,
  edges: graph.nodes.flatMap((node, index) =>
    Array.from({ length: 8 }, (_, offset) => ({
      from: node.ref,
      to: graph.nodes[(index + offset + 1) % size]!.ref,
      kind: 'relatedTo',
    })),
  ),
};
const composition = composeVacpProviders([
  {
    ...provider,
    observe: () => ({ revision: 'static', observedAt: '', graph: linkedGraph, state }),
  },
]);
try {
  await measure('composition with 8,000 edges', () => composition.read());
} finally {
  composition.dispose();
}

let revision = 0;
const changing = createVacpRuntime({
  providers: [
    {
      ...provider,
      observe: () => ({
        revision: String(++revision),
        observedAt: '',
        graph,
        state: { ...state, 'vacp://bench/0': { value: revision, selected: false } },
      }),
    },
  ],
});
try {
  changing.subscribeSnapshots(() => {});
  changing.stopObserving();
  await measure('changing subscribed snapshot', () => changing.getCapabilities());
} finally {
  changing.dispose();
}
