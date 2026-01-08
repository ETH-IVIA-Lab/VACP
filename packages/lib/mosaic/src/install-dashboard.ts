import type { VacpChangeSource, VacpRef } from '@vacp/core';
import { createDuckDbDataSqlHandler } from '@vacp/duckdb';
import {
  installVacpRuntimeBridge,
  registerVacpApplyStateAction,
  registerVacpDataSqlAction,
  VacpActionRegistry,
} from '@vacp/gateway';

import { actionDescriptorsForDashboard } from './actions';
import { makeApplyStateHandler } from './apply-state';
import { registerMosaicDashboardActions } from './dashboard-actions';
import { createMosaicDashboardSnapshots } from './dashboard-snapshots';
import { collectMosaicDataHandles, discoverPlotTables } from './data-handles';
import { quoteTableRef, whereClauseForMosaicDashboardSelection } from './duckdb-selection';
import { collectInputs, type CollectedInput } from './inputs';
import { buildDashboardGraph } from './graph';
import { installMosaicInputObservers, installMosaicPlotObservers, installMosaicTableObservers } from './observe';
import { makeViewRef } from './refs';
import { createRuntimeNotifier } from './runtime';
import { sqlForMosaicTableView } from './table-actions';
import type { InstallVacpOnVgplotDashboardOptions, VgplotPlotLike, VgplotTableLike } from './types';

export function installVacpOnVgplotDashboard(args: {
  root: ParentNode;
  plots: Array<{ plotId: string; plot: VgplotPlotLike; element: Element; svg?: SVGElement }>;
  tables?: Array<{ tableId: string; table: VgplotTableLike; element: Element }>;
  options: InstallVacpOnVgplotDashboardOptions;
}): void {
  const { root, plots, options } = args;
  const tables = args.tables ?? [];

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

  const tablesById = new Map<string, VgplotTableLike>(tables.map((t) => [t.tableId, t.table]));
  const defaultTableId = tables[0]?.tableId ?? '';
  const resolveTable = (params: Record<string, unknown>): { tableId: string; table: VgplotTableLike } => {
    if (!defaultTableId) throw new Error('No tables are available for this Mosaic view');
    const tid = typeof params.tableId === 'string' && params.tableId ? params.tableId : defaultTableId;
    const table = tablesById.get(tid);
    if (!table) throw new Error(`Unknown tableId: ${tid}`);
    return { tableId: tid, table };
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
    tables: tables.map((t) => ({ tableId: t.tableId, table: t.table })),
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

  registerMosaicDashboardActions({ register, resolvePlot, resolveTable, resolveInput });

  const viewRef = makeViewRef({ appId: options.appId, viewId: options.viewId, suffix: '' });

  const applyDesc = registerVacpApplyStateAction(
    actionRegistry,
    makeApplyStateHandler({ inputByRef, plotsById, tablesById }),
    {
      targetRef: viewRef,
      description: 'Apply a state map to Mosaic plots, tables, and inputs (best-effort).',
    },
  );
  actionDescriptors.push(applyDesc);

  const preferredTables = Array.from(
    new Set(inputs.map((i) => i.meta.from).filter((t): t is string => typeof t === 'string' && t.length > 0)),
  );
  const dataHandles = collectMosaicDataHandles({
    plots: plots.map((p) => ({ plotId: p.plotId, plot: p.plot })),
    tables: tables.map((t) => ({ tableId: t.tableId, table: t.table })),
    options,
    preferredTables,
  });
  const handleByRef = new Map<VacpRef, { surfaceKind: 'plot' | 'table'; surfaceId: string; table?: string }>(
    dataHandles.map((h) => [h.ref, { surfaceKind: h.surfaceKind, surfaceId: h.surfaceId, table: h.table }]),
  );

  if (options.duckdbClient && dataHandles.length) {
    const dataSqlDesc = registerVacpDataSqlAction(
      actionRegistry,
      createDuckDbDataSqlHandler({
        duckdb: options.duckdbClient,
        resolveHandle: async (ref) => {
          const meta = handleByRef.get(ref);
          if (!meta) return null;
          const plot = meta.surfaceKind === 'plot' ? plotsById.get(meta.surfaceId) : null;
          const tableObj = meta.surfaceKind === 'table' ? tablesById.get(meta.surfaceId) : null;
          const tableName =
            meta.table ??
            (plot ? discoverPlotTables(plot)[0] : null) ??
            (tableObj && typeof tableObj.from === 'string' ? tableObj.from : null) ??
            undefined;
          if (!tableName) {
            const emptySql = 'SELECT NULL::INTEGER AS __vacp_empty WHERE FALSE';
            return { allSql: emptySql, selectedSql: emptySql };
          }

          const where = whereClauseForMosaicDashboardSelection({ plots: plots.map((p) => p.plot), inputs });
          if (tableObj) {
            return sqlForMosaicTableView({
              tableName,
              where,
              sortColumn: tableObj.sortColumn ?? null,
              sortDesc: Boolean(tableObj.sortDesc),
              offset: typeof tableObj.offset === 'number' ? tableObj.offset : null,
              limit: typeof tableObj.limit === 'number' ? tableObj.limit : null,
            });
          }

          const table = quoteTableRef(tableName);
          const allSql = `SELECT * FROM ${table}`;
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
    tables: tables.map((t) => ({ tableId: t.tableId, table: t.table })),
    inputs,
    options,
    actions: actionDescriptors,
    dataHandles,
  });

  const snapshots = createMosaicDashboardSnapshots({
    graph,
    options,
    inputs,
    plots: plots.map((p) => ({ plotId: p.plotId, plot: p.plot })),
    tables: tables.map((t) => ({ tableId: t.tableId, table: t.table })),
    dataHandles,
    plotsById,
    tablesById,
  });

  const bridge = installVacpRuntimeBridge({
    snapshots,
    actions: actionRegistry,
    playbooks: options.playbooks,
    globalKey: options.globalKey,
  });
  const { notifyRuntime } = createRuntimeNotifier({
    getSource: () => lastChangeSource,
    refresh: ({ source, message }) => bridge.refresh?.({ source, message }),
  });

  installMosaicInputObservers({ inputs, notifyRuntime });
  installMosaicPlotObservers({ plots, notifyRuntime });
  installMosaicTableObservers({ tables, notifyRuntime });

  notifyRuntime('installed', { immediate: true });
}
