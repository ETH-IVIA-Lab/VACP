import { providerBindings } from './provider-bindings';
import type { VacpRef, VacpProvider, VacpSourceId } from '@vacp/protocol';
import { createDuckDbDataSqlHandler, getDuckDbTableMetadata } from '@vacp/data-duckdb';
import {
  registerVacpApplyStateAction,
  registerVacpDataSchemaAction,
  registerVacpDataSqlAction,
  registerVacpWidgetOptionsAction,
  createVacpProvider,
  VacpActionRegistry,
} from '@vacp/runtime';

import { actionDescriptorsForDashboard } from './actions';
import { prepareVgplotRestoration } from './apply-state';
import { createVgplotBindings } from './bindings';
import { createVgplotOperations } from './operations';
import { createVgplotDashboardSnapshots } from './dashboard-snapshots';
import { collectVgplotDataHandles, discoverPlotTables } from './data-handles';
import { quoteTableRef, whereClauseForVgplotDashboardSelection } from './duckdb-selection';
import { collectInputs, type CollectedInput } from './inputs';
import { buildDashboardGraph } from './graph';
import { createVgplotObservationBinding } from './observe';
import { makePlotRef, makeViewRef } from './refs';
import { sqlForVgplotTableView } from './table-actions';
import type { VgplotProviderOptions, VgplotPlotLike, VgplotTableLike } from './types';

export function createVgplotProvider(args: {
  root?: ParentNode;
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>;
  tables?: Array<{ tableId: string; table: VgplotTableLike }>;
  options: VgplotProviderOptions;
}): VacpProvider {
  const { root, plots, options } = args;
  const tables = args.tables ?? [];

  const sourceId: VacpSourceId = `vacp-source://${options.appId}/${options.viewId}/vgplot`;
  const actionRegistry = new VacpActionRegistry(sourceId);

  const inputs = root ? collectInputs(root, options) : [];
  const inputByRef = new Map<VacpRef, CollectedInput>(inputs.map((i) => [i.ref, i]));

  const plotsById = new Map<string, VgplotPlotLike>(plots.map((p) => [p.plotId, p.plot]));
  const tablesById = new Map<string, VgplotTableLike>(tables.map((t) => [t.tableId, t.table]));
  const bindings = createVgplotBindings({ plots, tables, inputs, options });
  const operations = createVgplotOperations(bindings);

  const actionDescriptors = actionDescriptorsForDashboard({
    bindings,
    options,
  });

  for (const descriptor of actionDescriptors) {
    actionRegistry.register(
      { ...descriptor, operation: { ...descriptor.operation, contract: descriptor.name } },
      (prepared: ReturnType<typeof operations.prepare>, options) => prepared.execute(options),
      { parse: (raw) => operations.prepare(descriptor.name, raw), focus: (prepared) => prepared.focus },
    );
  }

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

        const safe = (value: unknown) => {
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
            return inst.data.map((o) => ({
              value: safe(o.value),
              label: typeof o.label === 'string' ? o.label : undefined,
            }));
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
      { inputRefs: [viewRef] },
    );

    actionDescriptors.push(widgetOptionsDesc);
  }

  const applyDesc = registerVacpApplyStateAction(
    actionRegistry,
    (state) => prepareVgplotRestoration(bindings, operations, state),
    {
      affects: [viewRef],
      description: 'Apply a state map to VGPlot plots, tables, and inputs.',
    },
  );

  actionDescriptors.push(applyDesc);

  const preferredTables = Array.from(
    new Set(inputs.map((i) => i.meta.from).filter((t): t is string => typeof t === 'string' && t.length > 0)),
  );

  const dataHandles = collectVgplotDataHandles({
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

          const where = whereClauseForVgplotDashboardSelection({ plots: plots.map((p) => p.plot), inputs });

          if (tableObj) {
            return sqlForVgplotTableView({
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
      {
        enabled: options.enableSql ?? true,
        inputRefs: [viewRef],
        description: 'Query the current VGPlot selection using DuckDB SQL.',
      },
    );

    if (dataSqlDesc) actionDescriptors.push(dataSqlDesc);

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
      { inputRefs: [viewRef] },
    );

    actionDescriptors.push(dataSchemaDesc);
  }

  const graph = buildDashboardGraph({
    bindings,
    options,
    actions: actionRegistry.list(),
    dataHandles,
  });

  const projection = createVgplotDashboardSnapshots({
    bindings,
    graph,
    options,
    dataHandles,
    plotsById,
    tablesById,
  });

  const binding = createVgplotObservationBinding(bindings);

  const provider = createVacpProvider({
    source: {
      id: sourceId,
      type: 'vgplot',
      title: options.title ?? options.viewId,
      description: options.description,
    },
    actions: actionRegistry,
    project: async () => {
      const projected = await projection.project();
      const freshness = Object.fromEntries(
        plots.flatMap(({ plotId, plot }) => {
          const value = binding.freshness(plot);
          return value ? [[makePlotRef({ ...options, plotId, suffix: '' }), value]] : [];
        }),
      );
      const statuses = plots.map(({ plot }) => binding.freshness(plot)?.status);
      const status = statuses.includes('error')
        ? 'error'
        : statuses.includes('running')
          ? 'running'
          : statuses.length && statuses.every((status) => status === 'current') && !tables.length
            ? 'current'
            : undefined;
      if (status) freshness[viewRef] = { status };
      return { ...projected, freshness };
    },
    subscribe: binding.subscribe,
    dispose: () => {
      providerBindings.delete(provider);
      binding.dispose();
    },
  });
  providerBindings.set(provider, bindings);
  return provider;
}
