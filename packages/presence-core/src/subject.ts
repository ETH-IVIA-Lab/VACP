import type { VacpGraph, VacpNode, VacpRef } from '@vacp/protocol';

type Index = { nodes: Map<VacpRef, VacpNode>; parents: Map<VacpRef, VacpRef> };
// Observed graphs are frozen and shared, so one index per graph serves every step and viewer.
const indexes = new WeakMap<VacpGraph, Index>();

function index(graph: VacpGraph): Index {
  let cached = indexes.get(graph);
  if (!cached) {
    cached = { nodes: new Map(graph.nodes.map((node) => [node.ref, node])), parents: new Map() };
    for (const edge of graph.edges) if (edge.kind === 'contains') cached.parents.set(edge.to, edge.from);
    indexes.set(graph, cached);
  }
  return cached;
}

/**
 * The analytical view a step works on: the nearest containing view of the focused node, then the
 * nearest visualization, then the node's own title. Labels read as "Age distribution" rather than
 * as an actor or a phase.
 */
export function presenceSubject(graph: VacpGraph, ref: VacpRef | undefined): string | undefined {
  if (!ref) return undefined;
  const { nodes, parents } = index(graph);
  const chain = [];
  // Hops are bounded, so a malformed containment cycle cannot stall presentation.
  for (let current: VacpRef | undefined = ref, hops = 0; current && hops < 12; current = parents.get(current), hops++) {
    const node = nodes.get(current);
    if (node) chain.push(node);
  }
  for (const kind of ['View', 'Visualization']) {
    const framing = chain.find((node) => node.kind === kind && node.title);
    if (framing) return framing.title;
  }
  return nodes.get(ref)?.title;
}
