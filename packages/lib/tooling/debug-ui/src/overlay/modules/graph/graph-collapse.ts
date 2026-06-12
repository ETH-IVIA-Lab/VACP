import type { VacpEdge, VacpGraph, VacpNode, VacpRef } from '@vacp/core';

export function containsChildrenByParent(edges: readonly VacpEdge[]): Map<VacpRef, VacpRef[]> {
  const children = new Map<VacpRef, VacpRef[]>();
  for (const edge of edges) {
    if (edge.kind !== 'contains') continue;
    const refs = children.get(edge.from) ?? [];
    refs.push(edge.to);
    children.set(edge.from, refs);
  }
  return children;
}

function refsWithContainsParent(children: ReadonlyMap<VacpRef, readonly VacpRef[]>): Set<VacpRef> {
  const childRefs = new Set<VacpRef>();
  for (const refs of children.values()) {
    for (const ref of refs) childRefs.add(ref);
  }
  return childRefs;
}

function refsWithChildren(children: ReadonlyMap<VacpRef, readonly VacpRef[]>): Set<VacpRef> {
  const refs = new Set<VacpRef>();
  for (const [ref, childRefs] of children) {
    if (childRefs.length > 0) refs.add(ref);
  }
  return refs;
}

export function descendantsFor(parent: VacpRef, children: ReadonlyMap<VacpRef, readonly VacpRef[]>): Set<VacpRef> {
  const descendants = new Set<VacpRef>();
  const stack = [...(children.get(parent) ?? [])];
  while (stack.length > 0) {
    const ref = stack.pop();
    if (!ref || descendants.has(ref)) continue;
    descendants.add(ref);
    stack.push(...(children.get(ref) ?? []));
  }
  return descendants;
}

export function visibleRefsForCollapse(args: {
  nodes: readonly VacpNode[];
  children: ReadonlyMap<VacpRef, readonly VacpRef[]>;
  collapsedRefs: ReadonlySet<VacpRef>;
}): Set<VacpRef> {
  const { nodes, children, collapsedRefs } = args;
  const allRefs = new Set(nodes.map((node) => node.ref));
  const containedRefs = refsWithContainsParent(children);
  const roots = nodes.filter((node) => !containedRefs.has(node.ref)).map((node) => node.ref);
  const queue = roots.length > 0 ? [...roots] : nodes.map((node) => node.ref);
  const visible = new Set<VacpRef>();

  for (let i = 0; i < queue.length; i++) {
    const ref = queue[i]!;
    if (!allRefs.has(ref) || visible.has(ref)) continue;
    visible.add(ref);
    if (collapsedRefs.has(ref)) continue;
    queue.push(...(children.get(ref) ?? []));
  }

  return visible;
}

export function hiddenRefsForCollapse(
  nodes: readonly VacpNode[],
  collapsedRefs: ReadonlySet<VacpRef>,
  children: ReadonlyMap<VacpRef, readonly VacpRef[]>,
): Set<VacpRef> {
  if (collapsedRefs.size === 0) return new Set();
  const visibleRefs = visibleRefsForCollapse({ nodes, children, collapsedRefs });
  const hidden = new Set<VacpRef>();
  for (const node of nodes) {
    if (!visibleRefs.has(node.ref)) hidden.add(node.ref);
  }
  return hidden;
}

function descendantParentsFor(graph: VacpGraph, ref: VacpRef): Set<VacpRef> {
  const children = containsChildrenByParent(graph.edges);
  const parents = refsWithChildren(children);
  const descendants = new Set<VacpRef>();
  const stack = [...(children.get(ref) ?? [])];

  while (stack.length > 0) {
    const child = stack.pop();
    if (!child || descendants.has(child)) continue;
    if (parents.has(child)) descendants.add(child);
    stack.push(...(children.get(child) ?? []));
  }

  return descendants;
}

export function nextCollapsedRefsForToggle(
  graph: VacpGraph,
  collapsedRefs: ReadonlySet<VacpRef>,
  ref: VacpRef,
): ReadonlySet<VacpRef> {
  const next = new Set(collapsedRefs);
  if (next.has(ref)) {
    next.delete(ref);
    return next;
  }

  next.add(ref);
  for (const descendant of descendantParentsFor(graph, ref)) {
    next.add(descendant);
  }
  return next;
}

export function pruneCollapsedRefsForGraph(
  graph: VacpGraph,
  collapsedRefs: ReadonlySet<VacpRef>,
): ReadonlySet<VacpRef> {
  const refs = new Set(graph.nodes.map((node) => node.ref));
  const next = new Set([...collapsedRefs].filter((ref) => refs.has(ref)));
  return next.size === collapsedRefs.size ? collapsedRefs : next;
}
