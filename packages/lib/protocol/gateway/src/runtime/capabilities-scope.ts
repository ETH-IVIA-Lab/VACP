import type {
  VacpActionDescriptor,
  VacpCapabilitiesRequest,
  VacpCapabilitiesSnapshot,
  VacpLayer,
  VacpNode,
  VacpNodeKind,
  VacpRef,
} from '@vacp/core';

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
  const uniq = Array.from(new Set(values.filter((x): x is VacpRef => typeof x === 'string' && x.length > 0)));
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
  if (!action.targetRef) return true;
  return survivingRefs.has(action.targetRef);
}

export function scopeCapabilitiesSnapshot(
  snapshot: VacpCapabilitiesSnapshot,
  request: VacpCapabilitiesRequest,
): VacpCapabilitiesSnapshot {
  const scope = normalizeRequest(request);
  const scopedNodes = snapshot.graph.nodes
    .filter((node) => includeByRefScope(node, scope) && includeByTypeScope(node, scope))
    .map((node) => {
      if (scope.includeNodeData) return node;
      const { data: _data, ...rest } = node;
      return rest;
    });

  const survivingRefs = new Set(scopedNodes.map((node) => node.ref));
  const scopedEdges = scope.includeEdges
    ? snapshot.graph.edges.filter((edge) => survivingRefs.has(edge.from) && survivingRefs.has(edge.to))
    : [];
  const scopedActions = scope.includeActions
    ? snapshot.graph.actions.filter((action) => scopeAction(action, survivingRefs))
    : [];

  return {
    version: snapshot.version,
    createdAt: snapshot.createdAt,
    graph: {
      version: snapshot.graph.version,
      nodes: scopedNodes,
      edges: scopedEdges,
      actions: scopedActions,
    },
  };
}
