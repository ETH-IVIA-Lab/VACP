import type { VacpCapabilitiesSnapshot, VacpRef, VacpStateSnapshot } from '@vacp/core';
import { fnv1a64Hex, stableStringify } from '@vacp/core';

export type VacpDomSnapshotSource = {
  getCapabilities: () => VacpCapabilitiesSnapshot | Promise<VacpCapabilitiesSnapshot>;
  getState: () => VacpStateSnapshot | Promise<VacpStateSnapshot>;
};

type DomSnapshotCache = {
  graphToken: string | null;
  stateCatalogToken: string | null;
  stateToken: string | null;
  stateFingerprints: Map<VacpRef, string>;
  refScriptIds: Map<VacpRef, string>;
};

const DOM_SNAPSHOT_CACHE = new Map<string, DomSnapshotCache>();

function hasDocument(): boolean {
  return typeof document !== 'undefined' && !!document && typeof document.getElementById === 'function';
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
  const created: DomSnapshotCache = {
    graphToken: null,
    stateCatalogToken: null,
    stateToken: null,
    stateFingerprints: new Map<VacpRef, string>(),
    refScriptIds: new Map<VacpRef, string>(),
  };
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
  if (existing && existing.tagName === 'SCRIPT') return existing as HTMLScriptElement;

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

function compactGraph(capabilities: VacpCapabilitiesSnapshot): {
  nodes: Array<{ ref: VacpRef; kind: string; layer: string; title?: string }>;
  edges: VacpCapabilitiesSnapshot['graph']['edges'];
  actions: Array<{ name: string; targetRef?: VacpRef; title?: string; description?: string }>;
} {
  // This intentionally strips graph payloads down to fields that are useful for
  // planning/action selection. Omitting richer provider metadata keeps DOM size
  // down and makes graph token churn far less likely between state updates.
  return {
    nodes: capabilities.graph.nodes.map((n) => ({
      ref: n.ref,
      kind: n.kind,
      layer: n.layer,
      ...(n.title ? { title: n.title } : {}),
    })),
    edges: capabilities.graph.edges,
    actions: capabilities.graph.actions.map((a) => ({
      name: a.name,
      ...(a.targetRef ? { targetRef: a.targetRef } : {}),
      ...(a.title ? { title: a.title } : {}),
      ...(a.description ? { description: a.description } : {}),
    })),
  };
}

function writeDomSnapshotBundle(args: {
  scriptId: string;
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
  // Canonical stringify + hash gives a cheap content token so we can skip DOM
  // writes when graph semantics are unchanged.
  const graphToken = `gr_${fnv1a64Hex(stableStringify(graph))}`;
  if (cache.graphToken !== graphToken) {
    graphScript.textContent = safeJsonForScriptTag({
      createdAt: args.capabilities.createdAt,
      token: graphToken,
      graph,
    });
    cache.graphToken = graphToken;
  }

  const nodeMeta = new Map<VacpRef, { kind: string; layer: string; title?: string }>();
  for (const node of graph.nodes) {
    nodeMeta.set(node.ref, { kind: node.kind, layer: node.layer, ...(node.title ? { title: node.title } : {}) });
  }

  const nextFingerprints = new Map<VacpRef, string>();
  const changedRefs: VacpRef[] = [];
  const removedRefs: VacpRef[] = [];

  const stateEntries = Object.entries(args.state.state) as Array<[VacpRef, unknown]>;
  // Sorted refs make catalog/index output deterministic, which keeps tokens
  // stable and avoids noisy updates from object key insertion order.
  stateEntries.sort((a, b) => a[0].localeCompare(b[0]));
  const summary = args.state.summary ?? ({} as Record<VacpRef, unknown>);

  for (const [ref, value] of stateEntries) {
    const hasSummary = Object.prototype.hasOwnProperty.call(summary, ref);
    // Fingerprints track value+summary at ref granularity so only changed refs
    // rewrite their script nodes; unchanged refs stay untouched in the DOM.
    const fingerprint = stableStringify({
      value,
      ...(hasSummary ? { summary: summary[ref] } : {}),
    });
    nextFingerprints.set(ref, fingerprint);
    if (cache.stateFingerprints.get(ref) !== fingerprint) changedRefs.push(ref);
  }

  for (const ref of cache.stateFingerprints.keys()) {
    if (!nextFingerprints.has(ref)) removedRefs.push(ref);
  }
  changedRefs.sort((a, b) => a.localeCompare(b));
  removedRefs.sort((a, b) => a.localeCompare(b));

  for (const ref of changedRefs) {
    const scriptId = nextRefScriptId(cache, root, ref);
    const script = ensureSnapshotScript({ id: scriptId, rootId: root, kind: 'snapshot-ref', ref });
    if (!script) continue;
    const value = args.state.state[ref];
    const hasSummary = Object.prototype.hasOwnProperty.call(summary, ref);
    script.textContent = safeJsonForScriptTag({
      createdAt: args.state.createdAt,
      ref,
      value,
      ...(hasSummary ? { summary: summary[ref] } : {}),
    });
  }

  for (const ref of removedRefs) {
    const scriptId = cache.refScriptIds.get(ref);
    if (scriptId && hasDocument()) {
      const script = document.getElementById(scriptId);
      if (script && script.tagName === 'SCRIPT') script.remove();
    }
    cache.refScriptIds.delete(ref);
  }

  cache.stateFingerprints = nextFingerprints;

  const refs = stateEntries.map(([ref]) => {
    const scriptId = nextRefScriptId(cache, root, ref);
    const meta = nodeMeta.get(ref);
    const hasSummary = Object.prototype.hasOwnProperty.call(summary, ref);
    return {
      ref,
      scriptId,
      ...(meta?.kind ? { kind: meta.kind } : {}),
      ...(meta?.layer ? { layer: meta.layer } : {}),
      ...(meta?.title ? { title: meta.title } : {}),
      ...(hasSummary ? { hasSummary: true } : {}),
    };
  });
  // Catalog token changes only when membership or ref metadata changes.
  const catalogToken = `cat_${fnv1a64Hex(stableStringify(refs))}`;
  const catalogChanged = cache.stateCatalogToken !== catalogToken;
  if (catalogChanged) {
    stateCatalogScript.textContent = safeJsonForScriptTag({
      createdAt: args.state.createdAt,
      token: catalogToken,
      refs,
    });
  }

  // State token reflects full state content; index consumers can use baseToken
  // + changedRefs/removedRefs to apply incremental updates.
  const stateToken = `st_${fnv1a64Hex(stableStringify({ state: args.state.state, summary: args.state.summary }))}`;
  const baseToken = cache.stateToken;
  const summaryRefCount = Object.keys(summary).length;

  stateIndexScript.textContent = safeJsonForScriptTag({
    createdAt: args.state.createdAt,
    token: stateToken,
    ...(baseToken ? { baseToken } : {}),
    changedRefs,
    removedRefs,
    catalog: {
      scriptId: stateCatalogId,
      token: catalogToken,
      changed: catalogChanged,
    },
  });
  cache.stateCatalogToken = catalogToken;
  cache.stateToken = stateToken;

  mainScript.textContent = safeJsonForScriptTag({
    createdAt: args.state.createdAt,
    format: 'vacp.dom_snapshot',
    graph: {
      scriptId: graphId,
      token: graphToken,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      actionCount: graph.actions.length,
    },
    state: {
      indexScriptId: stateIndexId,
      catalogScriptId: stateCatalogId,
      token: stateToken,
      ...(baseToken ? { baseToken } : {}),
      catalogToken,
      refCount: refs.length,
      summaryRefCount,
      changedRefCount: changedRefs.length,
      removedRefCount: removedRefs.length,
    },
  });
}

export function defaultVacpDomSnapshotScriptId(globalKey: string): string {
  const key = typeof globalKey === 'string' && globalKey.length ? globalKey : '__vacp';
  return sanitizeDomId(`${key}_snapshot`);
}

export function removeVacpDomSnapshotScript(scriptId: string): void {
  if (!hasDocument()) return;
  const all = document.querySelectorAll(`script[data-vacp-root="${scriptId}"]`);
  for (const el of all) el.remove();
  const main = document.getElementById(scriptId);
  if (main && main.tagName === 'SCRIPT') main.remove();
  DOM_SNAPSHOT_CACHE.delete(scriptId);
}

export async function updateVacpDomSnapshotScript(args: {
  source: VacpDomSnapshotSource;
  scriptId: string;
}): Promise<void> {
  try {
    const [capabilities, state] = await Promise.all([args.source.getCapabilities(), args.source.getState()]);
    writeDomSnapshotBundle({
      scriptId: args.scriptId,
      capabilities,
      state,
    });
  } catch {
    // Never break the host app if snapshots are temporarily unavailable.
  }
}

export function writeVacpDomSnapshotScript(args: {
  scriptId: string;
  capabilities: VacpCapabilitiesSnapshot;
  state: VacpStateSnapshot;
}): void {
  writeDomSnapshotBundle({
    scriptId: args.scriptId,
    capabilities: args.capabilities,
    state: args.state,
  });
}
