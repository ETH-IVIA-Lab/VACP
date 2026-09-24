import { VACP_SCHEMA_VERSION, type VacpGraph, type VacpObservation, type VacpRef } from '@vacp/protocol';
import { writeVacpDomSnapshotScript } from '../src/dom-snapshot';
import { measure } from '../../../tools/benchmark';

// The writer only creates, finds, fills, and removes script elements, so a small stand-in document
// isolates its own cost from the browser's.
class Script {
  readonly tagName = 'SCRIPT';
  id = '';
  type = '';
  textContent = '';
  readonly attributes = new Map<string, string>();
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  remove() {
    scripts.delete(this.id);
  }
}
const scripts = new Map<string, Script>();
const head = { appendChild: (script: Script) => scripts.set(script.id, script) };
Object.assign(globalThis, {
  HTMLScriptElement: Script,
  document: { head, createElement: () => new Script(), getElementById: (id: string) => scripts.get(id) ?? null },
});

const refs = 400;
const rows = Array.from({ length: 200 }, (_, index) => ({ id: index, value: index * 1.5, label: `row ${index}` }));
const ref = (index: number) => `vacp://bench/view/${index}` as VacpRef;
const state = Object.fromEntries(
  Array.from({ length: refs }, (_, index) => [ref(index), index % 20 ? { value: index } : { rows }]),
);
const graph: VacpGraph = {
  version: VACP_SCHEMA_VERSION,
  sources: [],
  ownership: { nodes: {}, actions: {} },
  nodes: Array.from({ length: refs }, (_, index) => ({ ref: ref(index), kind: 'Param', layer: 'ConfigLayer' })),
  edges: [],
  actions: [],
};

let revision = 0;
const snapshot = () => {
  revision++;
  // One parameter moves per snapshot, the common case while a person or agent brushes a chart. Composition
  // clones every provider observation, so unchanged refs arrive as new objects.
  const next = structuredClone({ ...state, [ref(1)]: { value: revision } });
  const observation: VacpObservation = {
    version: VACP_SCHEMA_VERSION,
    revision: `obs_${revision}`,
    observedAt: '2026-01-01T00:00:00.000Z',
    graph,
    state: next,
  };
  writeVacpDomSnapshotScript({
    scriptId: '__vacp_bench_snapshot',
    observation,
    capabilities: { version: VACP_SCHEMA_VERSION, createdAt: observation.observedAt, graph },
    state: { version: VACP_SCHEMA_VERSION, createdAt: observation.observedAt, state: next },
  });
  const manifest = JSON.parse(scripts.get('__vacp_bench_snapshot')!.textContent);
  const index = JSON.parse(scripts.get(manifest.state.indexScriptId)!.textContent);
  if (index.revision !== `obs_${revision}` || (revision > 1 && index.changedRefs.join() !== ref(1)))
    throw new Error(`Snapshot ${revision} published ${index.changedRefs.length} changed refs`);
};

console.log(`Node ${process.version}; ${refs} refs, ${refs / 20} holding ${rows.length} rows; one ref changes`);
await measure('DOM snapshot write', snapshot, 200);
