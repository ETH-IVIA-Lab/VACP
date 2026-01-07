import type {
  VacpCapabilitiesSnapshot,
  VacpDemo,
  VacpGraph,
  VacpRef,
  VacpRuntimeBridge,
  VacpStateSnapshot,
} from '@vacp/core';
import { nowIso, VACP_SCHEMA_VERSION } from '@vacp/core';
import type { VacpDomAnnotation, VacpInteractionAnnotation } from '@vacp/dom';
import { applyVacpAttributes, applyVacpInteractionAttributes, embedVacpGraphInSvg } from '@vacp/dom';
import { installVacpRuntimeBridge, type VacpSnapshotProvider, VacpActionRegistry } from '@vacp/gateway';

/**
 * High-level helpers for building a VACP-enabled visualization (project concepts).
 *
 * The lower-level building blocks live in:
 * - `@vacp/core`: the protocol types (graph, state, actions)
 * - `@vacp/gateway`: the in-page runtime bridge (`window.__vacp`)
 * - `@vacp/dom`: optional DOM/SVG annotations for fallback + debugging
 *
 * This package is intentionally tiny: it aims to remove boilerplate when a
 * visualization wants to "BYO provider" without committing to Mosaic or Vega.
 */

export type VacpRefBuilder = {
  /** Root reference (`vacp://app/view` or `vacp://app/view/viz`). */
  root: VacpRef;
  /** Create a stable child ref by appending a suffix path. */
  ref: (suffix?: string) => VacpRef;
};

function joinRef(root: string, suffix: string): string {
  if (!suffix) return root;
  if (suffix === '/') return root;
  if (suffix.startsWith('/')) return `${root}${suffix}`;
  return `${root}/${suffix}`;
}

/**
 * Create a stable `vacp://...` ref namespace for a view (and optional viz id).
 *
 * Example:
 * - `root`: `vacp://myapp/myview/scatter`
 * - `ref('/selection/points')`: `vacp://myapp/myview/scatter/selection/points`
 */
export function createVacpRefBuilder(args: { appId: string; viewId: string; vizId?: string }): VacpRefBuilder {
  const parts = [args.appId, args.viewId, args.vizId].filter(Boolean) as string[];
  const root = `vacp://${parts.join('/')}` as VacpRef;
  return { root, ref: (suffix) => joinRef(root, suffix ?? '') as VacpRef };
}

export type VacpGraphBase = Omit<VacpGraph, 'actions'>;

/**
 * Create a snapshot provider for an app-specific graph + state function.
 *
 * This keeps `graph.actions` automatically in sync with the registered actions
 * (removes a common source of drift in examples).
 */
export function createVacpSnapshotProvider(args: {
  graph: VacpGraphBase;
  actions: VacpActionRegistry;
  getState: () => Record<VacpRef, unknown> | Promise<Record<VacpRef, unknown>>;
  getSummary?: () => Record<VacpRef, unknown> | Promise<Record<VacpRef, unknown> | undefined>;
}): VacpSnapshotProvider & { getGraph: () => VacpGraph } {
  const getGraph = (): VacpGraph => ({ ...args.graph, actions: args.actions.list() });
  return {
    getGraph,
    getCapabilities: async (): Promise<VacpCapabilitiesSnapshot> => ({
      version: VACP_SCHEMA_VERSION,
      createdAt: nowIso(),
      graph: getGraph(),
    }),
    getState: async (): Promise<VacpStateSnapshot> => ({
      version: VACP_SCHEMA_VERSION,
      createdAt: nowIso(),
      state: await args.getState(),
      summary: args.getSummary ? await args.getSummary() : undefined,
    }),
  };
}

export type VacpDomInstallArgs = {
  /** Element to annotate with stable identity + semantics. */
  root: Element;
  rootAnnotation: VacpDomAnnotation;
  /** Optional "what can I do here?" action metadata. */
  interactions?: Omit<VacpInteractionAnnotation, 'actions'> & { actions: () => VacpInteractionAnnotation['actions'] };
  /** If provided, embed the VACP graph into this SVG via `<metadata>`. */
  svg?: SVGElement;
  getGraph: () => VacpGraph;
};

/**
 * Apply optional DOM/SVG annotations for discovery + fallback.
 *
 * Note: this is *not* required for the protocol to work (the preferred
 * integration is the runtime bridge).
 */
export function installVacpDom(args: VacpDomInstallArgs): void {
  applyVacpAttributes(args.root, args.rootAnnotation);
  if (args.interactions) {
    applyVacpInteractionAttributes(args.root, { ...args.interactions, actions: args.interactions.actions() });
  }
  if (args.svg) embedVacpGraphInSvg(args.svg, args.getGraph());
}

/**
 * One-call convenience: create provider snapshots + install a stable runtime bridge.
 */
export function installVacpProvider(args: {
  graph: VacpGraphBase;
  actions: VacpActionRegistry;
  getState: () => Record<VacpRef, unknown> | Promise<Record<VacpRef, unknown>>;
  getSummary?: () => Record<VacpRef, unknown> | Promise<Record<VacpRef, unknown> | undefined>;
  demos?: VacpDemo[];
  globalKey?: string;
}): { bridge: VacpRuntimeBridge; snapshots: VacpSnapshotProvider & { getGraph: () => VacpGraph } } {
  const snapshots = createVacpSnapshotProvider({
    graph: args.graph,
    actions: args.actions,
    getState: args.getState,
    getSummary: args.getSummary,
  });
  const bridge = installVacpRuntimeBridge({
    snapshots,
    actions: args.actions,
    demos: args.demos,
    globalKey: args.globalKey,
  });
  return { bridge, snapshots };
}
