import { measure } from '../../../tools/benchmark';
import { resolveVacpObservation, VACP_SCHEMA_VERSION, type VacpObservation } from '@ethivia/vacp-protocol';
import { scopeCapabilitiesSnapshot } from '../src/runtime/capabilities-scope';
import { scopeStateSnapshot } from '../src/runtime/state-update';

const size = 5_000;
const observation: VacpObservation = {
  version: VACP_SCHEMA_VERSION,
  revision: 'benchmark',
  observedAt: '',
  graph: {
    sources: [],
    ownership: { nodes: {}, actions: {} },
    nodes: [],
    actions: [],
    edges: [],
  },
  state: {},
};
for (let index = 0; index < size; index++) {
  const ref = `vacp://bench/${index}` as const;
  observation.graph.nodes.push({ ref, kind: index % 2 ? 'Param' : 'View', layer: 'ConfigLayer' });
  observation.graph.actions.push({
    name: `set.${index}`,
    description: 'Set value',
    operation: { kind: 'mutation', affects: [ref] },
  });
  observation.graph.ownership.nodes[ref] = 'vacp-source://benchmark';
  observation.graph.ownership.actions[`set.${index}`] = 'vacp-source://benchmark';
  observation.state[ref] = index;
}
console.log(`Node ${process.version}; ${size} nodes and actions`);
await measure(
  'unrestricted disclosure',
  () => {
    const result = resolveVacpObservation(observation);
    if (result.observation.graph.actions.length !== size) throw new Error('Incomplete catalog');
  },
  20,
);
const gated = structuredClone(observation);
gated.graph.nodes[0]!.availability = { unavailable: 'Choose data' };
for (let index = 0; index < size; index++) {
  const node = gated.graph.nodes[index]!;
  if (index % 2) node.availability = { requires: ['vacp://bench/0'] };
  gated.graph.actions[index]!.availability = { requires: [node.ref] };
}
await measure(
  'half-hidden disclosure',
  () => {
    const result = resolveVacpObservation(gated);
    if (result.observation.graph.actions.length !== size / 2 - 1) throw new Error('Incorrect disclosure');
  },
  20,
);
const chain = structuredClone(observation);
for (let index = 1; index < size; index++)
  chain.graph.nodes[index]!.availability = { requires: [chain.graph.nodes[index - 1]!.ref] };
await measure(
  'deep prerequisite chain',
  () => {
    const result = resolveVacpObservation(chain);
    if (!result.availability.nodes.get(chain.graph.nodes.at(-1)!.ref)!.available) throw new Error('Incomplete chain');
  },
  20,
);
const snapshot = { version: VACP_SCHEMA_VERSION, createdAt: '', graph: observation.graph };
const refs = observation.graph.nodes.filter((node) => node.kind === 'Param').map((node) => node.ref);
await measure(
  'scope 2,500 explicit refs and related actions',
  () => {
    const scoped = scopeCapabilitiesSnapshot(snapshot, { refs });
    if (scoped.graph.actions.length !== refs.length || scoped.graph.nodes.length !== refs.length)
      throw new Error('Incorrect scope');
  },
  10,
);

await measure(
  'scope state to 2,500 ref subtrees',
  () => {
    const scoped = scopeStateSnapshot(
      { version: VACP_SCHEMA_VERSION, createdAt: '', state: observation.state },
      { refs },
    );
    if (Object.keys(scoped.snapshot.state).length !== refs.length) throw new Error('Incorrect state scope');
  },
  10,
);
