import { resolveVacpAvailability, type VacpRef, type VacpSourceId } from '@ethivia/vacp-protocol';
import type { InspectionObservation } from './types';

type Graph = InspectionObservation['graph'];
type Action = Graph['actions'][number];
type Edge = Graph['edges'][number];

/** Build once per displayed observation. Custom kinds, layers, and relationships remain intact. */
export function createInspectionIndex(observation: InspectionObservation) {
  const graph = observation.graph;
  const availability = resolveVacpAvailability(graph);
  const nodes = new Map(graph.nodes.map((node) => [node.ref, node]));
  const sources = new Map(graph.sources.map((source) => [source.id, source]));
  const actions = new Map(graph.actions.map((action) => [action.name, action]));
  const dependents = new Map<VacpRef, Graph['nodes'][number][]>();
  for (const node of graph.nodes) {
    for (const ref of new Set(node.availability?.requires ?? [])) {
      const entries = dependents.get(ref) ?? [];
      entries.push(node);
      dependents.set(ref, entries);
    }
  }
  const prerequisites = (refs: readonly VacpRef[] = []) =>
    Object.freeze([...new Set(refs)].map((ref) => nodes.get(ref)!));
  const incoming = new Map<VacpRef, Edge[]>();
  const outgoing = new Map<VacpRef, Edge[]>();
  const operations = new Map<VacpRef, Action[]>();
  for (const edge of graph.edges) {
    const from = outgoing.get(edge.from) ?? [];
    from.push(edge);
    outgoing.set(edge.from, from);
    const to = incoming.get(edge.to) ?? [];
    to.push(edge);
    incoming.set(edge.to, to);
  }
  for (const action of graph.actions) {
    const refs = new Set([
      ...(action.availability?.requires ?? []),
      ...(action.operation.inputRefs ?? []),
      ...(action.operation.affects ?? []),
      ...(action.operation.results?.flatMap((result) => (result.ref ? [result.ref] : [])) ?? []),
    ]);
    for (const ref of refs) {
      const related = operations.get(ref) ?? [];
      related.push(action);
      operations.set(ref, related);
    }
  }
  return {
    observation,
    availableActions: Object.freeze(graph.actions.filter((action) => availability.actions.get(action.name)!.available)),
    source: (id: VacpSourceId) => sources.get(id),
    action: (name: string) => {
      const descriptor = actions.get(name);
      return descriptor
        ? {
            descriptor,
            availability: availability.actions.get(name)!,
            prerequisites: prerequisites(descriptor.availability?.requires),
            source: sources.get(graph.ownership.actions[name]),
          }
        : undefined;
    },
    entity: (ref: VacpRef) => {
      const node = nodes.get(ref);
      if (!node) return undefined;
      return {
        node,
        availability: availability.nodes.get(ref)!,
        prerequisites: prerequisites(node.availability?.requires),
        dependents: Object.freeze(dependents.get(ref) ?? []),
        source: sources.get(graph.ownership.nodes[ref]),
        hasValue: Object.hasOwn(observation.state, ref),
        value: observation.state[ref],
        summary: observation.summary?.[ref],
        freshness: observation.freshness?.[ref],
        incoming: Object.freeze(incoming.get(ref) ?? []),
        outgoing: Object.freeze(outgoing.get(ref) ?? []),
        actions: Object.freeze(operations.get(ref) ?? []),
      };
    },
  };
}

export type InspectionIndex = ReturnType<typeof createInspectionIndex>;
export type InspectionEntity = NonNullable<ReturnType<InspectionIndex['entity']>>;
