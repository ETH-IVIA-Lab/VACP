import { refAncestors, matchesRefScope } from './ref-scope';
import type {
  VacpActionDescriptor,
  VacpCapabilitiesRequest,
  VacpCapabilitiesSnapshot,
  VacpLayer,
  VacpNode,
  VacpNodeKind,
  VacpRef,
} from '@vacp/protocol';

type NormalizedScope = {
  refs?: Set<string>;
  prefixes?: Set<string>;
  kinds?: Set<VacpNodeKind>;
  layers?: Set<VacpLayer>;
  includeActions: boolean;
  includeEdges: boolean;
  includeNodeData: boolean;
};

function set<Value>(values: readonly Value[] | undefined): Set<Value> | undefined {
  return values?.length ? new Set(values) : undefined;
}

function normalizeRequest(request: VacpCapabilitiesRequest): NormalizedScope {
  return {
    refs: set<string>(request.refs),
    prefixes: set<string>(request.prefixes),
    kinds: set(request.kinds),
    layers: set(request.layers),
    includeActions: request.includeActions ?? true,
    includeEdges: request.includeEdges ?? true,
    includeNodeData: request.includeNodeData ?? true,
  };
}

function includeByRefScope(node: VacpNode, scope: NormalizedScope): boolean {
  if (!scope.refs && !scope.prefixes) return true;
  if (scope.refs?.has(node.ref)) return true;
  return !!scope.prefixes && matchesRefScope(node.ref, scope.prefixes);
}

function includeByTypeScope(node: VacpNode, scope: NormalizedScope): boolean {
  if (scope.kinds && !scope.kinds.has(node.kind)) return false;

  if (scope.layers && !scope.layers.has(node.layer)) return false;

  return true;
}

function scopeAction(action: VacpActionDescriptor, relatedRefs: Set<string>): boolean {
  const refs = [
    ...(action.availability?.requires ?? []),
    ...(action.operation.inputRefs ?? []),
    ...(action.operation.affects ?? []),
  ];
  if (!refs.length) return true;
  return refs.some((ref) => relatedRefs.has(ref));
}

export function scopeCapabilitiesSnapshot(
  snapshot: VacpCapabilitiesSnapshot,
  request: VacpCapabilitiesRequest,
): VacpCapabilitiesSnapshot {
  const scope = normalizeRequest(request);

  const survivingRefs = new Set(
    snapshot.graph.nodes
      .filter((node) => includeByRefScope(node, scope) && includeByTypeScope(node, scope))
      .map((node) => node.ref),
  );
  // Index relationships once rather than rescanning every selected ref for every action.
  const relatedRefs = new Set<string>();
  if (scope.includeActions) {
    for (const ref of survivingRefs) for (const ancestor of refAncestors(ref)) relatedRefs.add(ancestor);
  }
  // Select actions against the requested scope before adding prerequisite context.
  const scopedActions = scope.includeActions
    ? snapshot.graph.actions.filter((action) => scopeAction(action, relatedRefs))
    : [];
  for (const action of scopedActions) {
    for (const ref of action.availability?.requires ?? []) survivingRefs.add(ref);
  }
  const nodes = new Map(snapshot.graph.nodes.map((node) => [node.ref, node]));
  // Set iteration visits newly added refs, retaining the full prerequisite closure.
  for (const ref of survivingRefs) {
    for (const required of nodes.get(ref)?.availability?.requires ?? []) survivingRefs.add(required);
  }
  const scopedNodes = snapshot.graph.nodes.flatMap((node) => {
    if (!survivingRefs.has(node.ref)) return [];
    if (scope.includeNodeData) return [node];
    const { data: _data, ...rest } = node;
    return [rest];
  });
  const scopedEdges = scope.includeEdges
    ? snapshot.graph.edges.filter((edge) => survivingRefs.has(edge.from) && survivingRefs.has(edge.to))
    : [];

  return {
    version: snapshot.version,
    createdAt: snapshot.createdAt,
    graph: {
      sources: snapshot.graph.sources,
      ownership: {
        nodes: Object.fromEntries(
          Object.entries(snapshot.graph.ownership.nodes).filter(([ref]) => survivingRefs.has(ref as VacpRef)),
        ),
        actions: Object.fromEntries(
          scopedActions.flatMap((action) => {
            const owner = snapshot.graph.ownership.actions[action.name];
            return owner ? [[action.name, owner]] : [];
          }),
        ),
      },
      nodes: scopedNodes,
      edges: scopedEdges,
      actions: scopedActions,
    },
  };
}
