import { jsonValue } from './json';
import { providerBindings } from './provider-bindings';
import type { VacpRef, VacpProvider, VacpSourceId, VacpWidgetOptionsResult } from '@ethivia/vacp-protocol';
import { createDuckDbDataSchemaHandler, createDuckDbDataSqlHandler } from '@ethivia/vacp-duckdb';
import {
  registerVacpApplyStateAction,
  registerVacpDataSchemaAction,
  registerVacpDataSqlAction,
  registerVacpWidgetOptionsAction,
  createVacpProvider,
  VacpActionRegistry,
} from '@ethivia/vacp-runtime';

import { actionDescriptorsForDashboard } from './actions';
import { prepareVgplotRestoration } from './apply-state';
import { createVgplotBindings } from './bindings';
import { createVgplotOperations } from './operations';
import { createVgplotDashboardSnapshots } from './dashboard-snapshots';
import { collectVgplotDataHandles } from './data-handles';
import { selectedSqlForVgplotTable } from './duckdb-selection';
import { collectInputs, menuOptions, type CollectedInput } from './inputs';
import { buildDashboardGraph } from './graph';
import { createVgplotObservationBinding } from './observe';
import { makePlotRef, makeViewRef } from './refs';
import type { VgplotProviderOptions, VgplotPlotLike, VgplotTableLike } from './types';

export function createVgplotProvider(args: {
  root?: ParentNode;
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>;
  tables?: Array<{ tableId: string; table: VgplotTableLike }>;
  data?: {
    duckdb:
      | import('@ethivia/vacp-duckdb').VacpDuckDbQueryClient
      | Promise<import('@ethivia/vacp-duckdb').VacpDuckDbQueryClient>;
    sql?: boolean;
    describe?: import('@ethivia/vacp-protocol').VacpDataHandleDescriber;
  };
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
    registerVacpWidgetOptionsAction(
      actionRegistry,
      async (params): Promise<VacpWidgetOptionsResult> => {
        const ref = params.ref;
        const input = inputByRef.get(ref);

        if (!input) throw new Error(`Unknown input ref: ${ref}`);

        try {
          const offset = params.offset ?? 0;
          const limit = params.limit ?? 200;
          const q = typeof params.query === 'string' ? params.query.trim().toLowerCase() : '';

          const rawOptions = menuOptions(input.input);

          const filtered = q
            ? rawOptions.filter((o) => {
                const label = (o.label ?? '').toLowerCase();
                const value = (
                  o.value == null
                    ? ''
                    : typeof o.value === 'string' ||
                        typeof o.value === 'number' ||
                        typeof o.value === 'boolean' ||
                        typeof o.value === 'bigint' ||
                        typeof o.value === 'symbol' ||
                        typeof o.value === 'function' ||
                        Array.isArray(o.value)
                      ? String(o.value)
                      : JSON.stringify(o.value)
                ).toLowerCase();

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
            options: slice.map((o) => ({ value: jsonValue(o.value), label: o.label })),
          };
        } catch (error) {
          return { ref, kind: 'Widget', readError: error instanceof Error ? error.message : String(error) };
        }
      },
      { inputRefs: [viewRef] },
    );
  }

  registerVacpApplyStateAction(actionRegistry, (state) => prepareVgplotRestoration(bindings, operations, state), {
    affects: [viewRef],
    description: 'Apply a state map to VGPlot plots, tables, and inputs.',
  });

  const preferredTables = Array.from(
    new Set(inputs.map((i) => i.meta.from).filter((t): t is string => typeof t === 'string' && t.length > 0)),
  );

  const dataHandles = args.data
    ? collectVgplotDataHandles({
        plots: plots.map((p) => ({ plotId: p.plotId, plot: p.plot })),
        tables: tables.map((t) => ({ tableId: t.tableId, table: t.table })),
        options,
        preferredTables,
      })
    : [];

  const tableByRef = new Map<VacpRef, string>(dataHandles.map((h) => [h.ref, h.table]));
  const surfaces = { plots: plots.map((p) => p.plot), tables: tables.map((t) => t.table) };

  if (args.data && dataHandles.length) {
    const duckdbClient = args.data.duckdb;

    if (args.data.sql ?? true)
      registerVacpDataSqlAction(
        actionRegistry,
        createDuckDbDataSqlHandler({
          duckdb: duckdbClient,
          resolveHandle: (ref) => {
            const table = tableByRef.get(ref);
            if (!table) return null;
            return {
              allSql: selectedSqlForVgplotTable(table, { plots: [], tables: [] }),
              selectedSql: selectedSqlForVgplotTable(table, surfaces),
            };
          },
        }),
        {
          inputRefs: [viewRef],
          description: 'Query the current VGPlot selection using DuckDB SQL.',
        },
      );

    registerVacpDataSchemaAction(
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
  }

  const graph = buildDashboardGraph({
    bindings,
    options,
    actions: actionRegistry.list(),
    dataHandles,
  });

  const projection = createVgplotDashboardSnapshots({ bindings, graph, data: args.data, dataHandles });

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
