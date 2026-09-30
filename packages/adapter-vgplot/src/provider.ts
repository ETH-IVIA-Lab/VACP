import { providerBindings } from './provider-bindings';
import type { VacpRef, VacpProvider, VacpSourceId } from '@vacp/protocol';
import { createDuckDbDataSchemaHandler, createDuckDbDataSqlHandler } from '@vacp/data-duckdb';
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
import { collectVgplotDataHandles } from './data-handles';
import { quoteTableRef, whereClauseForVgplotTable } from './duckdb-selection';
import { collectInputs, type CollectedInput } from './inputs';
import { buildDashboardGraph } from './graph';
import { createVgplotObservationBinding } from './observe';
import { makePlotRef, makeViewRef } from './refs';
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

  const tableByRef = new Map<VacpRef, string>(dataHandles.map((h) => [h.ref, h.table]));
  const surfaces = { plots: plots.map((p) => p.plot), tables: tables.map((t) => t.table) };

  if (options.duckdbClient && dataHandles.length) {
    const duckdbClient = options.duckdbClient;

    const dataSqlDesc = registerVacpDataSqlAction(
      actionRegistry,
      createDuckDbDataSqlHandler({
        duckdb: duckdbClient,
        resolveHandle: (ref) => {
          const table = tableByRef.get(ref);
          if (!table) return null;
          const where = whereClauseForVgplotTable(table, surfaces);
          const allSql = `SELECT * FROM ${quoteTableRef(table)}`;
          return { allSql, selectedSql: where ? `${allSql} WHERE ${where}` : allSql };
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
      createDuckDbDataSchemaHandler({
        duckdb: duckdbClient,
        resolveHandle: (ref) => {
          const table = tableByRef.get(ref);
          return table ? { table } : null;
        },
      }),
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

  const projection = createVgplotDashboardSnapshots({ bindings, graph, options, dataHandles });

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
