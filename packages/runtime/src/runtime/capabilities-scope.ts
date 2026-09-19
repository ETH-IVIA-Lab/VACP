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
  refs?: VacpRef[];
  prefixes?: VacpRef[];
  kinds?: Set<VacpNodeKind>;
  layers?: Set<VacpLayer>;
  includeActions: boolean;
  includeEdges: boolean;
  includeNodeData: boolean;
};

function normalizeRefs(values: VacpRef[] | undefined): VacpRef[] | undefined {
  if (!Array.isArray(values) || values.length === 0) return undefined;
  const uniq = Array.from(new Set(values.filter((x) => x.length > 0)));

  if (!uniq.length) return undefined;

  return uniq.sort();
}

function normalizeKinds(values: VacpNodeKind[] | undefined): Set<VacpNodeKind> | undefined {
  if (!Array.isArray(values) || values.length === 0) return undefined;

  return new Set(values);
}

function normalizeLayers(values: VacpLayer[] | undefined): Set<VacpLayer> | undefined {
  if (!Array.isArray(values) || values.length === 0) return undefined;

  return new Set(values);
}

function normalizeRequest(request: VacpCapabilitiesRequest): NormalizedScope {
  return {
    refs: normalizeRefs(request.refs),
    prefixes: normalizeRefs(request.prefixes),
    kinds: normalizeKinds(request.kinds),
    layers: normalizeLayers(request.layers),
    includeActions: request.includeActions ?? true,
    includeEdges: request.includeEdges ?? true,
    includeNodeData: request.includeNodeData ?? true,
  };
}

function matchesPrefix(ref: VacpRef, prefixes: VacpRef[] | undefined): boolean {
  if (!prefixes || prefixes.length === 0) return false;

  return prefixes.some((prefix) => ref === prefix || ref.startsWith(`${prefix}/`));
}

function includeByRefScope(node: VacpNode, scope: NormalizedScope): boolean {
  const hasRefScope = Boolean((scope.refs && scope.refs.length) || (scope.prefixes && scope.prefixes.length));

  if (!hasRefScope) return true;

  if (scope.refs?.includes(node.ref)) return true;

  return matchesPrefix(node.ref, scope.prefixes);
}

function includeByTypeScope(node: VacpNode, scope: NormalizedScope): boolean {
  if (scope.kinds && !scope.kinds.has(node.kind)) return false;

  if (scope.layers && !scope.layers.has(node.layer)) return false;

  return true;
}

function scopeAction(action: VacpActionDescriptor, survivingRefs: Set<VacpRef>): boolean {
  const refs = [
    ...(action.availability?.requires ?? []),
    ...(action.operation.inputRefs ?? []),
    ...(action.operation.affects ?? []),
  ];
  if (!refs.length) return true;
  return refs.some(
    (actionRef) => survivingRefs.has(actionRef) || [...survivingRefs].some((ref) => ref.startsWith(`${actionRef}/`)),
  );
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
  // Select actions against the requested scope before adding prerequisite context.
  const scopedActions = scope.includeActions
    ? snapshot.graph.actions.filter((action) => scopeAction(action, survivingRefs))
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
      version: snapshot.graph.version,
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
