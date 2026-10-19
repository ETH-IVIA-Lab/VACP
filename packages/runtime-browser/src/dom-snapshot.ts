import type { VacpCapabilitiesSnapshot, VacpObservation, VacpRef, VacpStateSnapshot } from '@ethivia/vacp-protocol';
import { isVacpRef, fnv1a64Hex, sameVacpValue, stableStringify } from '@ethivia/vacp-protocol';

/** What a ref script holds besides its timestamp, kept to compare the next snapshot against. */
type WrittenRef = { value: unknown; summary?: unknown };

type DomSnapshotCache = {
  graph?: CompactGraph;
  graphToken?: string;
  catalog?: CatalogRef[];
  catalogToken?: string;
  revision?: string;
  written: Map<VacpRef, WrittenRef>;
  refScriptIds: Map<VacpRef, string>;
};

const DOM_SNAPSHOT_CACHE = new Map<string, DomSnapshotCache>();

function hasDocument(): boolean {
  return typeof document !== 'undefined' && !!document;
}

function sanitizeDomId(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_:-]/g, '_');
}

function safeJsonForScriptTag(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function graphScriptId(scriptId: string): string {
  return sanitizeDomId(`${scriptId}__graph`);
}

function stateIndexScriptId(scriptId: string): string {
  return sanitizeDomId(`${scriptId}__state_index`);
}

function stateCatalogScriptId(scriptId: string): string {
  return sanitizeDomId(`${scriptId}__state_catalog`);
}

function getOrCreateCache(scriptId: string): DomSnapshotCache {
  const existing = DOM_SNAPSHOT_CACHE.get(scriptId);

  if (existing) return existing;

  const created: DomSnapshotCache = { written: new Map(), refScriptIds: new Map() };

  DOM_SNAPSHOT_CACHE.set(scriptId, created);

  return created;
}

function ensureSnapshotScript(args: {
  id: string;
  rootId: string;
  kind: 'snapshot' | 'snapshot-graph' | 'snapshot-state-index' | 'snapshot-state-catalog' | 'snapshot-ref';
  ref?: VacpRef;
}): HTMLScriptElement | null {
  if (!hasDocument()) return null;
  const existing = document.getElementById(args.id);

  if (existing instanceof HTMLScriptElement) return existing;

  const script = document.createElement('script');
  script.id = args.id;
  script.type = 'application/json';
  script.setAttribute('data-vacp', args.kind);
  script.setAttribute('data-vacp-id', args.id);
  script.setAttribute('data-vacp-root', args.rootId);

  if (args.ref) script.setAttribute('data-vacp-ref', args.ref);
  (document.head ?? document.body ?? document.documentElement).appendChild(script);

  return script;
}

function nextRefScriptId(cache: DomSnapshotCache, rootId: string, ref: VacpRef): string {
  const known = cache.refScriptIds.get(ref);

  if (known) return known;

  // Ref ids must be stable across updates so catalog entries remain reusable and
  // callers do not need to re-discover script locations on every tick.
  const base = sanitizeDomId(`${rootId}__ref_${fnv1a64Hex(ref).slice(0, 12)}`);
  let id = base;
  let idx = 1;
  const used = new Set(cache.refScriptIds.values());

  while (used.has(id) && idx < 10_000) {
    id = `${base}_${idx}`;
    idx += 1;
  }

  cache.refScriptIds.set(ref, id);

  return id;
}

type CompactNode = Pick<
  VacpCapabilitiesSnapshot['graph']['nodes'][number],
  'ref' | 'kind' | 'layer' | 'title' | 'availability'
>;

type CompactAction = {
  name: string;
  operation: VacpCapabilitiesSnapshot['graph']['actions'][number]['operation'];
  availability?: VacpCapabilitiesSnapshot['graph']['actions'][number]['availability'];
  title?: string;
  description?: string;
};

type CompactGraph = {
  nodes: CompactNode[];
  edges: VacpCapabilitiesSnapshot['graph']['edges'];
  actions: CompactAction[];
};

type CatalogRef = { ref: VacpRef; scriptId: string; kind?: string; layer?: string; title?: string; hasSummary?: true };

function compactGraph(capabilities: VacpCapabilitiesSnapshot): CompactGraph {
  const nodes = capabilities.graph.nodes.map((node) => {
    const compact: CompactNode = { ref: node.ref, kind: node.kind, layer: node.layer };

    if (node.title) compact.title = node.title;
    if (node.availability) compact.availability = node.availability;

    return compact;
  });

  const actions = capabilities.graph.actions.map((action) => {
    const compact: CompactAction = { name: action.name, operation: action.operation };

    if (action.title) compact.title = action.title;
    if (action.availability) compact.availability = action.availability;

    if (action.description) compact.description = action.description;

    return compact;
  });

  return { nodes, edges: capabilities.graph.edges, actions };
}

/**
 * Publish a live snapshot as linked script elements. The runtime writes one snapshot per observation
 * revision or graph change, so the revision identifies the state and each ref is compared structurally
 * with the value last written. Only changed refs, and the catalog or graph when they change, are
 * serialized again.
 */
export function writeVacpDomSnapshotScript(args: {
  scriptId: string;
  observation: VacpObservation;
  capabilities: VacpCapabilitiesSnapshot;
  state: VacpStateSnapshot;
}): void {
  const root = args.scriptId;
  const mainScript = ensureSnapshotScript({ id: root, rootId: root, kind: 'snapshot' });
  const graphId = graphScriptId(root);
  const stateIndexId = stateIndexScriptId(root);
  const stateCatalogId = stateCatalogScriptId(root);
  const graphScript = ensureSnapshotScript({ id: graphId, rootId: root, kind: 'snapshot-graph' });
  const stateIndexScript = ensureSnapshotScript({ id: stateIndexId, rootId: root, kind: 'snapshot-state-index' });

  const stateCatalogScript = ensureSnapshotScript({
    id: stateCatalogId,
    rootId: root,
    kind: 'snapshot-state-catalog',
  });

  if (!mainScript || !graphScript || !stateIndexScript || !stateCatalogScript) return;

  const cache = getOrCreateCache(root);
  const graph = compactGraph(args.capabilities);
  if (!cache.graph || !sameVacpValue(cache.graph, graph)) {
    cache.graph = graph;
    cache.graphToken = `gr_${fnv1a64Hex(stableStringify(graph))}`;
    graphScript.textContent = safeJsonForScriptTag({
      createdAt: args.capabilities.createdAt,
      token: cache.graphToken,
      graph,
    });
  }

  const nodeMeta = new Map<VacpRef, CompactNode>();

  for (const node of graph.nodes) {
    nodeMeta.set(node.ref, node);
  }

  const summary = args.state.summary ?? {};
  // Sorted refs keep the catalog and change lists independent of object key order.
  const refs = Object.keys(args.state.state).filter(isVacpRef).sort();
  const written = new Map<VacpRef, WrittenRef>();
  const changedRefs: VacpRef[] = [];

  for (const ref of refs) {
    const entry: WrittenRef = { value: args.state.state[ref] };

    if (Object.hasOwn(summary, ref)) entry.summary = summary[ref];
    written.set(ref, entry);
    const previous = cache.written.get(ref);

    if (previous && sameVacpValue(previous, entry)) continue;
    changedRefs.push(ref);
    const script = ensureSnapshotScript({
      id: nextRefScriptId(cache, root, ref),
      rootId: root,
      kind: 'snapshot-ref',
      ref,
    });

    if (script) script.textContent = safeJsonForScriptTag({ createdAt: args.state.createdAt, ref, ...entry });
  }

  const removedRefs = [...cache.written.keys()].filter((ref) => !written.has(ref)).sort();

  for (const ref of removedRefs) {
    const scriptId = cache.refScriptIds.get(ref);

    if (scriptId && hasDocument()) {
      const script = document.getElementById(scriptId);

      if (script && script.tagName === 'SCRIPT') script.remove();
    }

    cache.refScriptIds.delete(ref);
  }

  cache.written = written;

  const catalog = refs.map((ref) => {
    const meta = nodeMeta.get(ref);
    const item: CatalogRef = { ref, scriptId: nextRefScriptId(cache, root, ref) };

    if (meta?.kind) item.kind = meta.kind;

    if (meta?.layer) item.layer = meta.layer;

    if (meta?.title) item.title = meta.title;

    if (Object.hasOwn(summary, ref)) item.hasSummary = true;

    return item;
  });

  // The catalog changes only with ref membership or metadata.
  const catalogChanged = !cache.catalog || !sameVacpValue(cache.catalog, catalog);

  if (catalogChanged) {
    cache.catalog = catalog;
    cache.catalogToken = `cat_${fnv1a64Hex(stableStringify(catalog))}`;
    stateCatalogScript.textContent = safeJsonForScriptTag({
      createdAt: args.state.createdAt,
      token: cache.catalogToken,
      refs: catalog,
    });
  }

  const { revision } = args.observation;
  const baseRevision = cache.revision;
  cache.revision = revision;

  // A reader holding `baseRevision` applies `changedRefs` and `removedRefs` to reach `revision`.
  const stateIndex: Record<string, unknown> = {
    createdAt: args.state.createdAt,
    revision,
    changedRefs,
    removedRefs,
    catalog: {
      scriptId: stateCatalogId,
      token: cache.catalogToken,
      changed: catalogChanged,
    },
  };

  if (baseRevision) stateIndex.baseRevision = baseRevision;

  stateIndexScript.textContent = safeJsonForScriptTag(stateIndex);

  mainScript.textContent = safeJsonForScriptTag({
    createdAt: args.state.createdAt,
    format: 'vacp.dom_snapshot',
    observation: {
      revision,
      sources: args.observation.graph.sources,
      freshness: args.observation.freshness,
    },
    graph: {
      scriptId: graphId,
      token: cache.graphToken,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      actionCount: graph.actions.length,
    },
    state: {
      indexScriptId: stateIndexId,
      catalogScriptId: stateCatalogId,
      catalogToken: cache.catalogToken,
      refCount: refs.length,
      summaryRefCount: Object.keys(summary).length,
      changedRefCount: changedRefs.length,
      removedRefCount: removedRefs.length,
    },
  });
}

export function defaultVacpDomSnapshotScriptId(globalKey: string): string {
  return sanitizeDomId(`${globalKey}_snapshot`);
}

export function removeVacpDomSnapshotScript(scriptId: string): void {
  if (!hasDocument()) return;
  const all = document.querySelectorAll(`script[data-vacp-root="${scriptId}"]`);

  for (const el of all) el.remove();
  const main = document.getElementById(scriptId);

  if (main && main.tagName === 'SCRIPT') main.remove();
  DOM_SNAPSHOT_CACHE.delete(scriptId);
}
