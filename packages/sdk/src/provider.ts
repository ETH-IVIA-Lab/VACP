import type { VacpChangeSource, VacpCapabilitiesSnapshot, VacpGraph, VacpRef, VacpStateSnapshot } from '@vacp/protocol';
import { nowIso, VACP_SCHEMA_VERSION } from '@vacp/protocol';
import { type VacpSnapshotProvider, type VacpActionExecutor, type VacpRuntime } from '@vacp/runtime';
import { installVacpRuntime, uninstallVacpRuntime } from '@vacp/runtime-browser';

export type VacpGraphBase<NodeData = Record<string, unknown>> = Omit<VacpGraph<NodeData>, 'actions'>;

/**
 * Create a snapshot provider for an app-specific graph + state function.
 *
 * This keeps `graph.actions` automatically in sync with the registered actions
 * (removes a common source of drift).
 */
export function createVacpSnapshotProvider<
  State extends object,
  Summary extends object = Record<VacpRef, unknown>,
  NodeData extends object = Record<string, unknown>,
>(args: {
  graph: VacpGraphBase<NodeData>;
  actions: VacpActionExecutor;
  getState: () => State | Promise<State>;
  getSummary?: () => Summary | undefined | Promise<Summary | undefined>;
}): VacpSnapshotProvider<State, Summary, NodeData> & { getGraph: () => VacpGraph<NodeData> } {
  const getGraph = (): VacpGraph<NodeData> => ({ ...args.graph, actions: args.actions.list() });

  return {
    getGraph,
    getCapabilities: async (): Promise<VacpCapabilitiesSnapshot<NodeData>> => ({
      version: VACP_SCHEMA_VERSION,
      createdAt: nowIso(),
      graph: getGraph(),
    }),
    getState: async (): Promise<VacpStateSnapshot<State, Summary>> => ({
      version: VACP_SCHEMA_VERSION,
      createdAt: nowIso(),
      state: await args.getState(),
      summary: args.getSummary ? await args.getSummary() : undefined,
    }),
  };
}

/**
 * Install a stable runtime bridge and return helpers for annotation + refresh.
 *
 * This is the integration point where a visualization wires VACP in:
 * - the visualization implementation remains framework/DOM-agnostic
 * - this layer adds discovery/control/history as an optional adapter
 */
export type VacpIntegration<
  State = Record<VacpRef, unknown>,
  Summary = Record<VacpRef, unknown>,
  NodeData = Record<string, unknown>,
> = {
  bridge: VacpRuntime;
  snapshots: VacpSnapshotProvider<State, Summary, NodeData> & { getGraph: () => VacpGraph<NodeData> };
  dispose: () => void;
  refresh: (source: VacpChangeSource, message: string) => void;
};

export function installVacp<
  State extends object,
  Summary extends object = Record<VacpRef, unknown>,
  NodeData extends object = Record<string, unknown>,
>(args: {
  globalKey?: string;
  graph: VacpGraphBase<NodeData>;
  actions: VacpActionExecutor;
  getState: () => State | Promise<State>;
  getSummary?: () => Summary | undefined | Promise<Summary | undefined>;
  /**
   * If true (default), inject a `type="application/json"` `<script>` tag whose
   * contents are pure JSON containing `{ capabilities, state }`.
   */
  injectDomSnapshot?: boolean;
  domSnapshotScriptId?: string;
}): VacpIntegration<State, Summary, NodeData> {
  const snapshots = createVacpSnapshotProvider({
    graph: args.graph,
    actions: args.actions,
    getState: args.getState,
    getSummary: args.getSummary,
  });

  const globalKey = args.globalKey ?? '__vacp';

  const bridge = installVacpRuntime({
    snapshots,
    actions: args.actions,
    globalKey,
    injectDomSnapshot: args.injectDomSnapshot,
    domSnapshotScriptId: args.domSnapshotScriptId,
  });

  const refresh = (source: VacpChangeSource, message: string) => {
    void bridge.refresh?.({ source, message }).catch(() => {});
  };

  return { bridge, snapshots, refresh, dispose: () => uninstallVacpRuntime({ globalKey }) };
}
