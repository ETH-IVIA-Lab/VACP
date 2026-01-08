import type {
  VacpActionCall,
  VacpActionDescriptor,
  VacpCapabilitiesSnapshot,
  VacpChangeSource,
  VacpStateSnapshot,
} from '@vacp/core';
import { nowIso, VACP_SCHEMA_VERSION } from '@vacp/core';
import { formatDuckDbTableMetadataSummary } from '@vacp/duckdb';
import { installVacpRuntimeBridge, registerVacpApplyStateAction, VacpActionRegistry } from '@vacp/gateway';

import { actionsForSpec } from './actions';
import { buildGraph } from './graph';
import { buildParamLookup, executeAction } from './execute';
import { installVegaLiteDuckDbDataHandle } from './duckdb-handle';
import { whereClauseForCurrentSelections } from './duckdb-selection';
import { makeRef } from './refs';
import { tryGetSignal } from './signals';
import type { InstallVacpOnVegaLiteOptions, VegaLiteSpecLike, VegaViewLike } from './types';

/**
 * Vega-Lite provider (project concepts).
 *
 * Vega-Lite defines parameters (`params`) for interactivity:
 * - variable params (scalars) can be bound to inputs or modified via signals
 * - selection params define interactive selections and compile to signals/state
 *
 * For VACP, parameters are the natural first-class control/state surface.
 */
export function installVacpOnVegaLiteView(args: {
  root: HTMLElement;
  view: VegaViewLike;
  spec: VegaLiteSpecLike;
  options: InstallVacpOnVegaLiteOptions;
}): void {
  const { root, view, spec, options } = args;

  const actionRegistry = new VacpActionRegistry();
  let lastChangeSource: VacpChangeSource = 'human';

  const helpers = buildParamLookup(spec, view);

  const actionDescriptors: VacpActionDescriptor[] = actionsForSpec(options, spec);
  actionDescriptors.forEach((desc) => {
    actionRegistry.register(desc, async (params) => {
      lastChangeSource = 'agent';
      try {
        const call: VacpActionCall = { callId: crypto.randomUUID(), name: desc.name, params };
        return await executeAction(view, call, helpers);
      } finally {
        queueMicrotask(() => {
          lastChangeSource = 'human';
        });
      }
    });
  });

  // Standard, generic action for "apply this desired state map" (best-effort).
  const vizRef = makeRef({ appId: options.appId, viewId: options.viewId, vizId: options.vizId, suffix: '' });
  const applyDescriptor = registerVacpApplyStateAction(
    actionRegistry,
    async (state) => {
      const errors: Array<{ ref: string; message: string }> = [];
      let applied = 0;

      for (const [ref, raw] of Object.entries(state)) {
        const name = ref.split('/param/')[1];
        if (!name) continue;
        const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const desired = (rec.value ?? raw) as unknown;
        const callId = crypto.randomUUID();
        lastChangeSource = 'agent';
        try {
          if (desired === null || desired === undefined) {
            await executeAction(view, { callId, name: 'vega_lite.clear_selection', params: { ref } }, helpers);
          } else {
            await executeAction(
              view,
              { callId, name: 'vega_lite.set_param', params: { ref, value: desired } },
              helpers,
            );
          }
          applied += 1;
        } catch (err) {
          errors.push({ ref, message: err instanceof Error ? err.message : String(err) });
        } finally {
          queueMicrotask(() => {
            lastChangeSource = 'human';
          });
        }
      }

      return { applied, errors };
    },
    { targetRef: vizRef, description: 'Apply a state map to Vega-Lite params (best-effort).' },
  );
  actionDescriptors.push(applyDescriptor);

  const dataHandle = installVegaLiteDuckDbDataHandle({ spec, view, options, actionRegistry, actionDescriptors });
  const handleRef = dataHandle?.ref ?? null;
  const tableName = dataHandle?.tableName ?? null;
  let handleMeta: (import('@vacp/duckdb').VacpDuckDbTableMetadata | null) = null;

  const graph = buildGraph({
    spec,
    options,
    actions: actionDescriptors,
    dataHandle: handleRef && tableName ? { ref: handleRef, data: { tableName } } : undefined,
  });

  const dataHandleNode =
    handleRef && tableName
      ? graph.nodes.find((n) => n.kind === 'DataHandle' && n.ref === handleRef)
      : null;

  const snapshots = {
    getCapabilities: async (): Promise<VacpCapabilitiesSnapshot> => ({
      version: VACP_SCHEMA_VERSION,
      createdAt: nowIso(),
      graph: await (async () => {
        if (dataHandle && dataHandleNode && !handleMeta) {
          handleMeta = await dataHandle.ensureMetadata();
          if (handleMeta) {
            (dataHandleNode as any).data = { ...(dataHandleNode as any).data, duckdb: handleMeta };
            (dataHandleNode as any).description = `DuckDB handle for "${tableName}".\n${formatDuckDbTableMetadataSummary(handleMeta)}`;
          }
        }
        return graph;
      })(),
    }),
    getState: async (): Promise<VacpStateSnapshot> => {
      const state: Record<string, unknown> = {};
      (spec.params ?? []).forEach((p) => {
        const pref = makeRef({
          appId: options.appId,
          viewId: options.viewId,
          vizId: options.vizId,
          suffix: `/param/${p.name}`,
        });
        const kind = p.select ? 'Selection' : 'Param';
        state[pref] = p.select
          ? { kind, name: p.name, value: tryGetSignal(view, p.name), select: p.select }
          : { kind, name: p.name, value: tryGetSignal(view, p.name), bind: p.bind };
      });
      if (handleRef) {
        state[handleRef] = {
          kind: 'DataHandle',
          tableName,
          selectionWhere: whereClauseForCurrentSelections(spec, view),
          selectedMeaning: 'rows matching current selection params; falls back to all rows if none',
        };
      }
      return { version: VACP_SCHEMA_VERSION, createdAt: nowIso(), state: state as any };
    },
  };

  const bridge = installVacpRuntimeBridge({
    snapshots,
    actions: actionRegistry,
    playbooks: options.playbooks,
    globalKey: options.globalKey,
  });

  // Keep the runtime timeline updated on human-driven signal changes.
  if (typeof view.addSignalListener === 'function') {
    let pendingTimer: number | null = null;
    const onSignal = () => {
      if (pendingTimer !== null) return;
      pendingTimer = window.setTimeout(() => {
        pendingTimer = null;
        if (typeof bridge.refresh === 'function') {
          void bridge.refresh({ source: lastChangeSource, message: 'signal change' }).catch(() => {});
        }
      }, 120);
    };

    const watched = new Set<string>();
    (spec.params ?? []).forEach((p) => {
      (helpers.watchedSignalsByParam.get(p.name) ?? [p.name]).forEach((s) => watched.add(s));
    });
    watched.forEach((s) => view.addSignalListener?.(s, onSignal));
  }
}
