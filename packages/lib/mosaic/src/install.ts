import type { VacpCapabilitiesSnapshot, VacpChangeSource, VacpRef, VacpStateSnapshot } from '@vacp/core';
import { nowIso, VACP_SCHEMA_VERSION } from '@vacp/core';
import { applyVacpAttributes } from '@vacp/dom';
import { createDuckDbDataSqlHandler, getDuckDbTableMetadata, type VacpDuckDbTableMetadata } from '@vacp/duckdb';
import {
  installVacpRuntimeBridge,
  registerVacpApplyStateAction,
  registerVacpDataSqlAction,
  VacpActionRegistry,
} from '@vacp/gateway';

import { actionDescriptorsForDashboard } from './actions';
import { makeApplyStateHandler } from './apply-state';
import { collectMosaicDataHandles, discoverPlotTables } from './data-handles';
import { quoteTableRef, whereClauseForMosaicDashboardSelection } from './duckdb-selection';
import { collectInputs, executeInputAction, type CollectedInput } from './inputs';
import { executeIntervalAction } from './interactors/interval';
import { executeLegendToggleAction } from './interactors/legend-toggle';
import { executeNearestAction } from './interactors/nearest';
import { executePanZoomAction } from './interactors/pan-zoom';
import { executeRegionAction } from './interactors/region';
import { executeToggleAction } from './interactors/toggle';
import { buildDashboardGraph } from './graph';
import { installMosaicInputObservers, installMosaicPlotObservers } from './observe';
import { makePlotRef, makeViewRef } from './refs';
import { createRuntimeNotifier } from './runtime';
import type { InstallVacpOnVgplotDashboardOptions, InstallVacpOnVgplotOptions, VgplotPlotLike } from './types';

export function installVacpOnVgplotDashboard(args: {
  root: ParentNode;
  plots: Array<{ plotId: string; plot: VgplotPlotLike; element: Element; svg?: SVGElement }>;
  options: InstallVacpOnVgplotDashboardOptions;
}): void {
  const { root, plots, options } = args;

  const actionRegistry = new VacpActionRegistry();
  let lastChangeSource: VacpChangeSource = 'human';

  const inputs = collectInputs(root, options);
  const inputByRef = new Map<VacpRef, CollectedInput>(inputs.map((i) => [i.ref, i]));

  const plotsById = new Map<string, VgplotPlotLike>(plots.map((p) => [p.plotId, p.plot]));
  const defaultPlotId = plots[0]?.plotId ?? '';
  const resolvePlot = (params: Record<string, unknown>): { plotId: string; plot: VgplotPlotLike } => {
    if (!defaultPlotId) throw new Error('No plots are available for this Mosaic view');
    const pid = typeof params.plotId === 'string' && params.plotId ? params.plotId : defaultPlotId;
    const plot = plotsById.get(pid);
    if (!plot) throw new Error(`Unknown plotId: ${pid}`);
    return { plotId: pid, plot };
  };

  const resolveInput = (params: Record<string, unknown>): CollectedInput => {
    const ref = typeof params.ref === 'string' ? (params.ref as VacpRef) : null;
    if (!ref) throw new Error('Expected params.ref to be a Widget vacp:// ref');
    const input = inputByRef.get(ref);
    if (!input) throw new Error(`Unknown input ref: ${ref}`);
    return input;
  };

  const actionDescriptors = actionDescriptorsForDashboard({
    plots: plots.map((p) => ({ plotId: p.plotId, plot: p.plot })),
    inputs,
    options,
  });

  const register = (name: string, handler: (params: unknown) => unknown | Promise<unknown>) => {
    const desc = actionDescriptors.find((a) => a.name === name);
    if (!desc) return;
    actionRegistry.register(desc, async (params) => {
      lastChangeSource = 'agent';
      try {
        return await handler(params);
      } finally {
        queueMicrotask(() => {
          lastChangeSource = 'human';
        });
      }
    });
  };

  register('mosaic.set_interval_1d', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeIntervalAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.set_interval_1d', params: p });
  });
  register('mosaic.clear_interval_1d', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeIntervalAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.clear_interval_1d', params: p });
  });
  register('mosaic.set_interval_2d', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeIntervalAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.set_interval_2d', params: p });
  });
  register('mosaic.clear_interval_2d', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeIntervalAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.clear_interval_2d', params: p });
  });
  register('mosaic.set_toggle', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeToggleAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.set_toggle', params: p });
  });
  register('mosaic.clear_toggle', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeToggleAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.clear_toggle', params: p });
  });
  register('mosaic.set_legend_toggle', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeLegendToggleAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.set_legend_toggle', params: p });
  });
  register('mosaic.clear_legend_toggle', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeLegendToggleAction(plot, {
      callId: crypto.randomUUID(),
      name: 'mosaic.clear_legend_toggle',
      params: p,
    });
  });
  register('mosaic.set_nearest', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeNearestAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.set_nearest', params: p });
  });
  register('mosaic.clear_nearest', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeNearestAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.clear_nearest', params: p });
  });
  register('mosaic.set_region', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeRegionAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.set_region', params: p });
  });
  register('mosaic.clear_region', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeRegionAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.clear_region', params: p });
  });
  register('mosaic.set_pan_zoom', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executePanZoomAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.set_pan_zoom', params: p });
  });
  register('mosaic.clear_pan_zoom', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executePanZoomAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.clear_pan_zoom', params: p });
  });
  register('mosaic.set_input_option_index', async (params) =>
    executeInputAction(resolveInput((params ?? {}) as any), { name: 'mosaic.set_input_option_index', params }),
  );
  register('mosaic.set_input_value', async (params) =>
    executeInputAction(resolveInput((params ?? {}) as any), { name: 'mosaic.set_input_value', params }),
  );
  register('mosaic.clear_input', async (params) =>
    executeInputAction(resolveInput((params ?? {}) as any), { name: 'mosaic.clear_input', params }),
  );

  const viewRef = makeViewRef({ appId: options.appId, viewId: options.viewId, suffix: '' });

  const applyDesc = registerVacpApplyStateAction(actionRegistry, makeApplyStateHandler({ inputByRef, plotsById }), {
    targetRef: viewRef,
    description: 'Apply a state map to Mosaic plots and inputs (best-effort).',
  });
  actionDescriptors.push(applyDesc);

  const preferredTables = Array.from(
    new Set(inputs.map((i) => i.meta.from).filter((t): t is string => typeof t === 'string' && t.length > 0)),
  );
  const dataHandles = collectMosaicDataHandles({
    plots: plots.map((p) => ({ plotId: p.plotId, plot: p.plot })),
    options,
    preferredTables,
  });
  const handleByRef = new Map<VacpRef, { plotId: string; table?: string }>(
    dataHandles.map((h) => [h.ref, { plotId: h.plotId, table: h.table }]),
  );

  if (options.duckdbClient && dataHandles.length) {
    const dataSqlDesc = registerVacpDataSqlAction(
      actionRegistry,
      createDuckDbDataSqlHandler({
        duckdb: options.duckdbClient,
        resolveHandle: async (ref) => {
          const meta = handleByRef.get(ref);
          if (!meta) return null;
          const plot = plotsById.get(meta.plotId);
          if (!plot) return null;
          const tableName = meta.table ?? discoverPlotTables(plot)[0];
          if (!tableName) {
            // Some Mosaic specs are "data-less" (axes demos, gridlines, etc).
            // Keep the VACP interface uniform by exposing an empty relation.
            const emptySql = 'SELECT NULL::INTEGER AS __vacp_empty WHERE FALSE';
            return { allSql: emptySql, selectedSql: emptySql };
          }
          const table = quoteTableRef(tableName);
          const allSql = `SELECT * FROM ${table}`;
          const where = whereClauseForMosaicDashboardSelection({ plots: plots.map((p) => p.plot), inputs });
          const selectedSql = where ? `SELECT * FROM ${table} WHERE ${where}` : allSql;
          return { allSql, selectedSql };
        },
      }),
      { targetRef: viewRef, description: 'Query the current Mosaic selection using DuckDB SQL.' },
    );
    actionDescriptors.push(dataSqlDesc);
  }

  const graph = buildDashboardGraph({
    plots: plots.map((p) => ({ plotId: p.plotId, plot: p.plot })),
    inputs,
    options,
    actions: actionDescriptors,
    dataHandles,
  });

  const dataHandleNodesByRef = new Map<VacpRef, unknown>();
  for (const n of graph.nodes) {
    if (n.kind !== 'DataHandle') continue;
    dataHandleNodesByRef.set(n.ref, n);
  }

  const duckdbMetaByTable = new Map<string, VacpDuckDbTableMetadata>();
  let duckdbMetaPromise: Promise<void> | null = null;
  const ensureDuckdbMeta = async () => {
    if (!options.duckdbClient || !dataHandles.length) return;
    if (duckdbMetaPromise) return await duckdbMetaPromise;
    duckdbMetaPromise = (async () => {
      for (const h of dataHandles) {
        const plot = plotsById.get(h.plotId);
        const tableName = h.table ?? (plot ? discoverPlotTables(plot)[0] : undefined);
        if (!tableName || duckdbMetaByTable.has(tableName)) continue;
        try {
          duckdbMetaByTable.set(
            tableName,
            await getDuckDbTableMetadata({ duckdb: options.duckdbClient!, table: tableName, sampleRows: 25_000 }),
          );
        } catch {
          // ignore: metadata is best-effort
        }
      }

      // Patch DataHandle nodes in-place so capabilities include schema/stats.
      for (const h of dataHandles) {
        const plot = plotsById.get(h.plotId);
        const tableName = h.table ?? (plot ? discoverPlotTables(plot)[0] : undefined);
        if (!tableName) continue;
        const meta = duckdbMetaByTable.get(tableName);
        if (!meta) continue;
        const node = dataHandleNodesByRef.get(h.ref) as any;
        if (!node || typeof node !== 'object') continue;
        node.data = { ...node.data, table: tableName, duckdb: meta };
      }
    })();
    await duckdbMetaPromise;
  };

  const snapshots = {
    getCapabilities: async (): Promise<VacpCapabilitiesSnapshot> => ({
      version: VACP_SCHEMA_VERSION,
      createdAt: nowIso(),
      graph: await (async () => {
        await ensureDuckdbMeta();
        return graph;
      })(),
    }),
    getState: async (): Promise<VacpStateSnapshot> => {
      const state: Record<VacpRef, unknown> = {};

      for (const input of inputs) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inst = input.input as any;
        const selected =
          typeof inst.selectedValue === 'function' ? inst.selectedValue() : inst.select ? inst.select.value : undefined;
        const optionCount = Array.isArray(inst.data)
          ? inst.data.length
          : inst.select?.options
            ? inst.select.options.length
            : undefined;
        state[input.ref] = { kind: 'Widget', widgetKind: input.meta.kind, value: selected, optionCount };
      }

      for (const { plotId, plot } of plots) {
        plot.interactors.forEach((interactor, i) => {
          const interactorRef = makePlotRef({
            appId: options.appId,
            viewId: options.viewId,
            plotId,
            suffix: `/interactor/${i}`,
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anyI = interactor as any;
          const selectionValue = anyI.selection?.value ?? undefined;
          const ctorName = interactor.constructor?.name ?? 'Interactor';
          state[interactorRef] = {
            kind: ctorName,
            plotId,
            value: interactor.value,
            selectionValue,
            ...(ctorName === 'PanZoom'
              ? {
                  x: anyI.xsel?.value ?? null,
                  y: anyI.ysel?.value ?? null,
                  xField: anyI.xfield ?? null,
                  yField: anyI.yfield ?? null,
                }
              : null),
          };
        });
      }

      if (dataHandles.length) {
        dataHandles.forEach((h) => {
          const plot = plotsById.get(h.plotId);
          state[h.ref] = {
            kind: 'DataHandle',
            table: h.table ?? (plot ? discoverPlotTables(plot)[0] : undefined),
            selectionWhere: plot
              ? whereClauseForMosaicDashboardSelection({ plots: plots.map((p) => p.plot), inputs })
              : null,
            selectedMeaning: 'rows matching current plot selection; falls back to all rows if none',
          };
        });
      }

      return { version: VACP_SCHEMA_VERSION, createdAt: nowIso(), state };
    },
  };

  const bridge = installVacpRuntimeBridge({
    snapshots,
    actions: actionRegistry,
    demos: options.demos,
    globalKey: options.globalKey,
  });
  const { notifyRuntime } = createRuntimeNotifier({
    getSource: () => lastChangeSource,
    refresh: ({ source, message }) => bridge.refresh?.({ source, message }),
  });

  installMosaicInputObservers({ inputs, graph, notifyRuntime });
  installMosaicPlotObservers({ plots, graph, appId: options.appId, viewId: options.viewId, notifyRuntime });

  notifyRuntime('installed', { immediate: true });
}

export function installVacpOnVgplot(plot: VgplotPlotLike, svg: SVGElement, options: InstallVacpOnVgplotOptions): void {
  installVacpOnVgplotDashboard({
    root: svg,
    plots: [{ plotId: options.plotId, plot, element: svg, svg }],
    options: {
      appId: options.appId,
      viewId: options.viewId,
      title: options.title,
      description: options.description,
      globalKey: options.globalKey,
      demos: options.demos,
    },
  });

  if (options.annotateHostElement && plot.element) {
    applyVacpAttributes(plot.element, {
      ref: makePlotRef({ appId: options.appId, viewId: options.viewId, plotId: options.plotId, suffix: '/host' }),
      layer: 'ViewLayer',
      kind: 'InteractionTarget',
      description: 'Host element containing the vgplot visualization and associated legends.',
      data: { plotId: options.plotId },
    });
  }
}
