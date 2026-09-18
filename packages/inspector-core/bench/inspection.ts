import { performance } from 'node:perf_hooks';
import { VACP_SCHEMA_VERSION, type VacpObservation } from '@vacp/protocol';
import { createInspectorSession, createInspectionIndex } from '../src/index';

const size = 1_000;
const observation: VacpObservation = {
  version: VACP_SCHEMA_VERSION,
  revision: 'static',
  observedAt: '',
  graph: {
    version: VACP_SCHEMA_VERSION,
    sources: [{ id: 'vacp-source://benchmark', type: 'benchmark', title: 'Inspection benchmark' }],
    ownership: { nodes: {}, actions: {} },
    nodes: [],
    edges: [],
    actions: [],
  },
  state: {},
};
for (let i = 0; i < size; i++) {
  const ref = `vacp://bench/${i}` as const;
  observation.graph.nodes.push({ ref, kind: 'Param', layer: 'ConfigLayer', title: `Parameter ${i}` });
  observation.graph.actions.push({
    name: `set.${i}`,
    description: `Set parameter ${i}`,
    operation: { kind: 'mutation', affects: [ref] },
  });
  observation.graph.ownership.nodes[ref] = 'vacp-source://benchmark';
  observation.graph.ownership.actions[`set.${i}`] = 'vacp-source://benchmark';
  observation.state[ref] = { value: i, selected: false };
}
const session = createInspectorSession({ id: 'benchmark', title: 'Benchmark', observe: async () => observation });
async function measure(name: string, run: () => unknown | Promise<unknown>) {
  for (let i = 0; i < 20; i++) await run();
  const rounds: number[] = [];
  for (let round = 0; round < 5; round++) {
    const start = performance.now();
    for (let i = 0; i < 100; i++) await run();
    rounds.push((performance.now() - start) / 100);
  }
  rounds.sort((a, b) => a - b);
  console.log(`${name}: ${rounds[2]!.toFixed(3)} ms/op (median of 5 x 100)`);
}
console.log(`Node ${process.version}; ${size} entities/actions/state refs`);
try {
  await measure('inspection capture', () => session.refresh());
  const captured = session.getState().observation!;
  await measure('index and visit every entity', () => {
    const index = createInspectionIndex(captured);
    for (const node of captured.graph.nodes) index.entity(node.ref);
  });
} finally {
  session.dispose();
}
