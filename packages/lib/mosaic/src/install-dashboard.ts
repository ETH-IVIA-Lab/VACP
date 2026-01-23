import type { VacpChangeSource, VacpRef } from '@vacp/core';
import { createDuckDbDataSqlHandler, getDuckDbTableMetadata } from '@vacp/duckdb';
import {
  installVacpRuntimeBridge,
  registerVacpApplyStateAction,
  registerVacpDataSchemaAction,
  registerVacpDataSqlAction,
  registerVacpWidgetOptionsAction,
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

  if (inputs.length) {
    const widgetOptionsDesc = registerVacpWidgetOptionsAction(
      actionRegistry,
      async (params) => {
        const ref = params.ref;
        const input = inputByRef.get(ref);
        if (!input) throw new Error(`Unknown input ref: ${ref}`);

        const offset = params.offset ?? 0;
        const limit = params.limit ?? 200;
        const q = typeof params.query === 'string' ? params.query.trim().toLowerCase() : '';

        const safe = (value: unknown): unknown => {
          if (value == null) return value;
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
          try {
            return JSON.parse(JSON.stringify(value));
          } catch {
            return String(value);
          }
        };

        const rawOptions: Array<{ value: unknown; label?: string }> = (() => {
          const inst = input.input;
          const select = inst.select;
          if (select && typeof select.options?.length === 'number') {
            return Array.from(select.options).map((o) => ({
              value: o.value,
              label: (typeof o.label === 'string' && o.label) || o.textContent?.trim() || undefined,
            }));
          }
          if (Array.isArray(inst.data)) {
            return inst.data.map((o) => ({ value: safe(o.value), label: typeof o.label === 'string' ? o.label : undefined }));
          }
          return [];
        })();

        const filtered = q
          ? rawOptions.filter((o) => {
              const label = (o.label ?? '').toLowerCase();
              const value = String(o.value ?? '').toLowerCase();
              return label.includes(q) || value.includes(q);
            })
          : rawOptions;

        const count = filtered.length;
        const slice = filtered.slice(offset, offset + limit);
        return {
          ref,
          offset,
          limit,
          count,
          truncated: offset + limit < count,
          options: slice.map((o) => ({ value: safe(o.value), label: o.label })),
        };
      },
      { targetRef: viewRef },
    );
    actionDescriptors.push(widgetOptionsDesc);
  }

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
    const duckdbClient = options.duckdbClient;
    const schemaCache = new Map<string, Awaited<ReturnType<typeof getDuckDbTableMetadata>>>();

    const resolveHandleTableName = (ref: VacpRef): string | null => {
      const meta = handleByRef.get(ref);
      if (!meta) return null;
      const plot = meta.surfaceKind === 'plot' ? plotsById.get(meta.surfaceId) : null;
      const tableObj = meta.surfaceKind === 'table' ? tablesById.get(meta.surfaceId) : null;
      return (
        meta.table ??
        (plot ? discoverPlotTables(plot)[0] : null) ??
        (tableObj && typeof tableObj.from === 'string' ? tableObj.from : null) ??
        null
      );
    };

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

    const dataSchemaDesc = registerVacpDataSchemaAction(
      actionRegistry,
      async (params) => {
        const tableName = resolveHandleTableName(params.handleRef);
        if (!tableName) {
          return {
            handleRef: params.handleRef,
            detail: params.detail ?? 'columns',
            table: null,
            rowCount: null,
            columns: [],
          };
        }

        const detail = params.detail ?? 'columns';
        const sampleRows = params.sampleRows;
        const cacheKey =
          detail === 'full'
            ? `${tableName}|full|${typeof sampleRows === 'number' ? sampleRows : 'default'}`
            : `${tableName}|columns`;

        const cached = schemaCache.get(cacheKey);
        if (cached) return { handleRef: params.handleRef, detail, ...cached };

        const meta = await getDuckDbTableMetadata({
          duckdb: duckdbClient,
          table: tableName,
          sampleRows: detail === 'full' ? (sampleRows ?? 25_000) : 0,
          maxNumericColumns: detail === 'full' ? undefined : 0,
          maxTemporalColumns: detail === 'full' ? undefined : 0,
          maxCategoricalColumns: detail === 'full' ? undefined : 0,
        });
        schemaCache.set(cacheKey, meta);
        return { handleRef: params.handleRef, detail, ...meta };
      },
      { targetRef: viewRef },
    );
    actionDescriptors.push(dataSchemaDesc);
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
    sessionKey: options.viewId,
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
