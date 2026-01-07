import type { VacpCapabilitiesSnapshot, VacpChangeSource, VacpRef, VacpStateSnapshot } from '@vacp/core';
import { nowIso, VACP_SCHEMA_VERSION } from '@vacp/core';
import { applyVacpAttributes } from '@vacp/dom';
import { createDuckDbDataSqlHandler } from '@vacp/duckdb';
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
import { executeToggleAction } from './interactors/toggle';
import { buildDashboardGraph } from './graph';
import { installMosaicInputObservers, installMosaicPlotObservers } from './observe';
import { makePlotRef, makeViewRef } from './refs';
import { createRuntimeNotifier } from './runtime';
import type { InstallVacpOnVgplotDashboardOptions, InstallVacpOnVgplotOptions, VgplotPlotLike } from './types';

export function installVacpOnVgplotDashboard(args: {
  root: ParentNode;
  plots: Array<{ plotId: string; plot: VgplotPlotLike; svg: SVGElement }>;
  options: InstallVacpOnVgplotDashboardOptions;
}): void {
  const { root, plots, options } = args;
  if (!plots.length) throw new Error('installVacpOnVgplotDashboard requires at least one plot');

  const actionRegistry = new VacpActionRegistry();
  let lastChangeSource: VacpChangeSource = 'human';

  const inputs = collectInputs(root, options);
  const inputByRef = new Map<VacpRef, CollectedInput>(inputs.map((i) => [i.ref, i]));

  const plotsById = new Map<string, VgplotPlotLike>(plots.map((p) => [p.plotId, p.plot]));
  const defaultPlotId = plots[0].plotId;
  const resolvePlot = (params: Record<string, unknown>): { plotId: string; plot: VgplotPlotLike } => {
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
          if (!tableName) return null;
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

  const snapshots = {
    getCapabilities: async (): Promise<VacpCapabilitiesSnapshot> => ({
      version: VACP_SCHEMA_VERSION,
      createdAt: nowIso(),
      graph,
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
          const selectionValue = interactor.selection?.value ?? undefined;
          state[interactorRef] = {
            kind: interactor.constructor?.name ?? 'Interactor',
            plotId,
            value: interactor.value,
            selectionValue,
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
    plots: [{ plotId: options.plotId, plot, svg }],
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
