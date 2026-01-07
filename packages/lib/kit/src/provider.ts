import type {
  VacpCapabilitiesSnapshot,
  VacpGraph,
  VacpLayer,
  VacpPlaybook,
  VacpRef,
  VacpRuntimeBridge,
  VacpStateSnapshot,
} from '@vacp/core';
import { nowIso, VACP_SCHEMA_VERSION } from '@vacp/core';
import type { VacpDomAnnotation, VacpInteractionAnnotation } from '@vacp/dom';
import { applyVacpAttributes, applyVacpInteractionAttributes, embedVacpGraphInSvg } from '@vacp/dom';
import { installVacpRuntimeBridge, type VacpSnapshotProvider, VacpActionRegistry } from '@vacp/gateway';

export type VacpGraphBase = Omit<VacpGraph, 'actions'>;

/**
 * Create a snapshot provider for an app-specific graph + state function.
 *
 * This keeps `graph.actions` automatically in sync with the registered actions
 * (removes a common source of drift).
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
 */
export function installVacpDom(args: VacpDomInstallArgs): void {
  applyVacpAttributes(args.root, args.rootAnnotation);
  if (args.interactions) {
    applyVacpInteractionAttributes(args.root, { ...args.interactions, actions: args.interactions.actions() });
  }
  if (args.svg) embedVacpGraphInSvg(args.svg, args.getGraph());
}

/**
 * Install a stable runtime bridge and return helpers for annotation + refresh.
 *
 * This is meant to be the “one place” where a visualization wires VACP in:
 * - the visualization implementation remains framework/DOM-agnostic
 * - this layer adds discovery/control/history as an optional adapter
 */
export function createVacpLayer(args: {
  globalKey?: string;
  graph: VacpGraphBase;
  actions: VacpActionRegistry;
  getState: () => Record<VacpRef, unknown> | Promise<Record<VacpRef, unknown>>;
  getSummary?: () => Record<VacpRef, unknown> | Promise<Record<VacpRef, unknown> | undefined>;
  playbooks?: VacpPlaybook[];
  dom?: {
    view: { root: Element; annotation: VacpDomAnnotation };
    viz?: {
      svg: SVGElement;
      annotation: VacpDomAnnotation;
      interactions?: { targetRef: VacpRef; layer: VacpLayer; description?: string };
    };
  };
}): {
  bridge: VacpRuntimeBridge;
  snapshots: VacpSnapshotProvider & { getGraph: () => VacpGraph };
  annotate: () => void;
  refresh: (source: 'human' | 'agent' | 'debug' | 'system', message: string) => void;
} {
  const snapshots = createVacpSnapshotProvider({
    graph: args.graph,
    actions: args.actions,
    getState: args.getState,
    getSummary: args.getSummary,
  });

  const bridge = installVacpRuntimeBridge({
    snapshots,
    actions: args.actions,
    demos: args.playbooks,
    globalKey: args.globalKey,
  });

  const annotate = () => {
    const getGraph = () => snapshots.getGraph();
    if (args.dom?.view) {
      installVacpDom({ root: args.dom.view.root, rootAnnotation: args.dom.view.annotation, getGraph });
    }
    if (args.dom?.viz) {
      const { svg, annotation, interactions } = args.dom.viz;
      installVacpDom({
        root: svg,
        svg,
        rootAnnotation: annotation,
        interactions: interactions
          ? {
              targetRef: interactions.targetRef,
              layer: interactions.layer,
              description: interactions.description,
              actions: () => args.actions.list(),
            }
          : undefined,
        getGraph,
      });
    }
  };

  const refresh = (source: 'human' | 'agent' | 'debug' | 'system', message: string) => {
    void bridge.refresh?.({ source, message }).catch(() => {});
  };

  return { bridge, snapshots, annotate, refresh };
}
