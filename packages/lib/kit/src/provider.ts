import type {
  VacpCapabilitiesSnapshot,
  VacpGraph,
  VacpPlaybook,
  VacpRef,
  VacpRuntimeBridge,
  VacpStateSnapshot,
} from '@vacp/core';
import { nowIso, VACP_SCHEMA_VERSION } from '@vacp/core';
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
}): {
  bridge: VacpRuntimeBridge;
  snapshots: VacpSnapshotProvider & { getGraph: () => VacpGraph };
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
    playbooks: args.playbooks,
    globalKey: args.globalKey,
  });

  const refresh = (source: 'human' | 'agent' | 'debug' | 'system', message: string) => {
    void bridge.refresh?.({ source, message }).catch(() => {});
  };

  return { bridge, snapshots, refresh };
}
