import { type VacpActionDescriptor, type VacpClock, type VacpRef } from '@vacp/protocol';
import type { VacpDuckDbTableMetadata } from '@vacp/data-duckdb';
import {
  createDuckDbDataSqlHandler,
  createDuckDbWasmClient,
  getDuckDbTableMetadata,
  makeVacpDuckDbTableName,
  type VacpDuckDbClient,
} from '@vacp/data-duckdb';
import { registerVacpDataSchemaAction, registerVacpDataSqlAction, type VacpActionRegistry } from '@vacp/runtime';

import type { VegaLiteBindings } from './bindings';
import { tableRows } from './data-rows';
import { collectSelectionFields, describeSource, scoreDataRows } from './data-sources';
import { whereClauseForCurrentSelections } from './duckdb-selection';
import { makeRef } from './refs';
import type { VegaLiteProviderOptions, VegaLiteSpecLike, VegaViewLike } from './types';

export type VegaLiteDuckDbDataHandle = {
  ref: VacpRef;
  /** The rows the chart's marks read, which `vacp_handle` narrows by selection and hover. */
  tableName: string;
  /** Every row the source loaded, before the chart's filters and aggregates, which `vacp_all` reads. */
  allTableName: string;
  title: string;
  sourceId: string;
  /** `vacp_handle`'s WHERE clause for the current selections and hover, or null when nothing narrows it. */
  selectionWhere: () => string | null;
  ensureMetadata: () => Promise<VacpDuckDbTableMetadata | null>;
};

/** Replace `table` with rows, typing the columns that hold instants as TIMESTAMP. */
async function loadTable(
  db: VacpDuckDbClient,
  table: string,
  { rows, timestamps }: { rows: Record<string, unknown>[]; timestamps: ReadonlyMap<string, VacpClock> },
) {
  await db.exec(`DROP TABLE IF EXISTS main.${table}`);
  await db.loadObjectsAsTable(table, rows, { create: true, timestamps: [...timestamps.keys()] });
}

/**
 * DuckDB-backed data handles for a Vega-Lite chart, one per source in its compiled dataflow. Each
 * answers `vacp.data_sql` and `vacp.data_schema` over the rows the marks read and the rows the
 * source loaded.
 */
export function createVegaLiteDataBinding(args: {
  spec: VegaLiteSpecLike;
  view: VegaViewLike;
  bindings: VegaLiteBindings;
  options: VegaLiteProviderOptions;
  actionRegistry: VacpActionRegistry;
  actionDescriptors: VacpActionDescriptor[];
  getHoverFields?: () => Readonly<Record<string, unknown>> | null;
}): { handles: VegaLiteDuckDbDataHandle[]; dispose: () => Promise<void> } {
  const { spec, view, bindings, options, actionRegistry, actionDescriptors } = args;

  if (!(options.enableDuckDbDataHandle ?? true)) return { handles: [], dispose: async () => {} };

  let disposeClient = async (): Promise<void> => {};
  const duckdbPromise = options.duckdbClient
    ? Promise.resolve(options.duckdbClient)
    : createDuckDbWasmClient({ log: false }).then((client) => {
        disposeClient = () => client.dispose();
        return client;
      });
  const base = `vacp_vl_${options.appId}_${options.viewId}_${options.vizId}`;
  const { sources, temporal } = bindings.dataflow;

  const shownRows = (dataset: string): unknown[] => {
    try {
      const rows = view.data?.(dataset);
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  };

  // The source whose rows carry the chart's selection fields is `/data/main`.
  const requiredFields = collectSelectionFields(spec);
  const scores = sources.map((source) => scoreDataRows(shownRows(source.shown), requiredFields));
  const primaryIndex = scores.indexOf(Math.max(...scores));

  const handlesInternal = sources.map((source, index) => {
    const { id, title } = describeSource(source, index);
    const ref = makeRef({ ...options, suffix: index === primaryIndex ? '/data/main' : `/data/src/${id}` });
    const tableName = makeVacpDuckDbTableName({ prefix: base, parts: [id] });
    const allTableName = source.transformed ? makeVacpDuckDbTableName({ prefix: base, parts: [id, 'all'] }) : tableName;
    let disposed = false;
    let tableTouched = false;
    let loadedRevision: string | null = null;
    let loadedInput: unknown[] | null = null;
    let metadata: { revision: string | null; value: VacpDuckDbTableMetadata } | null = null;
    let loading: Promise<void> = Promise.resolve();
    let fields: ReadonlySet<string> = new Set();
    let timestamps: ReadonlyMap<string, VacpClock> = new Map();

    // Rows are normalized and serialized again only when Vega reports a dataset change.
    let dataVersion = 0;
    const onData = () => {
      dataVersion++;
    };
    const listening = (() => {
      if (!view.addDataListener || !view.removeDataListener) return false;
      try {
        view.addDataListener(source.shown, onData);
        return true;
      } catch {
        // Without a native witness every read serializes the rows it loads.
        return false;
      }
    })();
    let prepared: (ReturnType<typeof tableRows> & { version: number; revision: string }) | undefined;
    const currentRows = () => {
      if (listening && prepared?.version === dataVersion) return prepared;
      const table = tableRows(shownRows(source.shown), temporal);
      prepared = { ...table, version: dataVersion, revision: JSON.stringify(table.rows) };
      return prepared;
    };

    const ensureDuckDbData = (): Promise<void> => {
      if (disposed) return Promise.reject(new Error('Vega-Lite data handle is disposed'));
      const current = currentRows();
      if (!current.rows.length)
        return Promise.reject(new Error(`No Vega-Lite rows available to load into DuckDB (${title})`));
      const input = source.transformed ? bindings.datasetInput(source.dataset) : null;
      if (source.transformed && !input)
        return Promise.reject(new Error(`Vega-Lite dataset ${source.dataset} has not loaded its source rows`));
      // Serialize table replacement. Compare after the previous write so failed loads can be retried.
      const next = loading.then(async () => {
        const db = await duckdbPromise;
        if (current.revision !== loadedRevision) {
          loadedRevision = null;
          fields = new Set();
          tableTouched = true;
          await loadTable(db, tableName, current);
          loadedRevision = current.revision;
          fields = new Set(current.rows.flatMap((row) => Object.keys(row)));
          timestamps = current.timestamps;
        }
        // Vega replaces a dataset's input collection when its source changes, so identity is the witness.
        if (input && input !== loadedInput) {
          loadedInput = null;
          tableTouched = true;
          await loadTable(db, allTableName, tableRows(input, temporal));
          loadedInput = input;
        }
      });
      loading = next.catch(() => {});
      return next;
    };

    const describe = async (table: string, detail: 'columns' | 'full', sampleRows?: number) =>
      await getDuckDbTableMetadata({
        duckdb: await duckdbPromise,
        table,
        sampleRows: detail === 'full' ? (sampleRows ?? 25_000) : 0,
        maxNumericColumns: detail === 'full' ? undefined : 0,
        maxTemporalColumns: detail === 'full' ? undefined : 0,
        maxCategoricalColumns: detail === 'full' ? undefined : 0,
      });

    return {
      ref,
      tableName,
      allTableName,
      title,
      sourceId: id,
      ensureDuckDbData,
      describe,
      selectionWhere: () =>
        whereClauseForCurrentSelections(spec, view, { names: fields, timestamps }, args.getHoverFields?.() ?? null),
      ensureMetadata: async (): Promise<VacpDuckDbTableMetadata | null> => {
        try {
          await ensureDuckDbData();
          const revision = loadedRevision;
          if (metadata?.revision === revision) return metadata.value;
          const value = await describe(tableName, 'columns');
          metadata = { revision, value };
          return value;
        } catch {
          return null;
        }
      },
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        if (listening) view.removeDataListener!(source.shown, onData);
        prepared = undefined;
        await loading;
        if (!tableTouched) return;
        const db = await duckdbPromise;
        await db.exec(`DROP TABLE IF EXISTS main.${tableName}`);
        if (allTableName !== tableName) await db.exec(`DROP TABLE IF EXISTS main.${allTableName}`);
      },
    };
  });

  // The primary `/data/main` handle comes first, so a reader that takes the first DataHandle gets it.
  handlesInternal.sort((a, b) => {
    const aMain = a.ref.endsWith('/data/main');
    const bMain = b.ref.endsWith('/data/main');
    if (aMain !== bMain) return aMain ? -1 : 1;
    return a.ref.localeCompare(b.ref);
  });

  const handlesByRef = new Map(handlesInternal.map((h) => [h.ref, h] as const));
  const inputRefs = handlesInternal.flatMap((handle) => (handle.ref.endsWith('/data/main') ? [handle.ref] : []));

  const dataSqlDesc = registerVacpDataSqlAction(
    actionRegistry,
    createDuckDbDataSqlHandler({
      duckdb: {
        exec: (sql) => duckdbPromise.then((d) => d.exec(sql)),
        queryJson: (sql) => duckdbPromise.then((d) => d.queryJson(sql)),
        queryArrowIpcBase64: (sql) => duckdbPromise.then((d) => d.queryArrowIpcBase64(sql)),
        loadObjectsAsTable: (t, rows, opts) => duckdbPromise.then((d) => d.loadObjectsAsTable(t, rows, opts)),
      },
      resolveHandle: async (ref) => {
        const handle = handlesByRef.get(ref);
        if (!handle) return null;
        await handle.ensureDuckDbData();
        const where = handle.selectionWhere();
        const shown = `SELECT * FROM ${handle.tableName}`;
        return {
          allSql: `SELECT * FROM ${handle.allTableName}`,
          selectedSql: where ? `${shown} WHERE ${where}` : shown,
        };
      },
    }),
    {
      inputRefs,
      enabled: options.enableSql ?? true,
      description:
        'Query the chart data with DuckDB SQL. `vacp_handle` holds the rows the marks read, narrowed by the current selections and hover. `vacp_all` holds every row the source loaded.',
    },
  );

  if (dataSqlDesc) actionDescriptors.push(dataSqlDesc);

  const dataSchemaDesc = registerVacpDataSchemaAction(
    actionRegistry,
    async (params) => {
      const handle = handlesByRef.get(params.handleRef);
      if (!handle) throw new Error(`Unknown DataHandle: ${params.handleRef}`);
      await handle.ensureDuckDbData();
      const detail = params.detail ?? 'columns';
      const meta = await handle.describe(handle.tableName, detail, params.sampleRows);
      const all =
        handle.allTableName === handle.tableName
          ? undefined
          : await handle.describe(handle.allTableName, detail, params.sampleRows);
      return { handleRef: params.handleRef, detail, ...meta, ...(all ? { vacp_all: all } : {}) };
    },
    {
      inputRefs,
      description:
        'Return the columns, types, and row count of a Vega-Lite DataHandle, for `vacp_handle` and, when the chart transforms its source, for `vacp_all`.',
    },
  );

  actionDescriptors.push(dataSchemaDesc);

  let disposal: Promise<void> | undefined;
  return {
    handles: handlesInternal,
    dispose: () =>
      (disposal ??= (async () => {
        const results = await Promise.allSettled(handlesInternal.map((handle) => handle.dispose()));
        await duckdbPromise;
        await disposeClient();
        const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
        if (errors.length) throw new AggregateError(errors, 'Failed to release Vega-Lite data tables');
      })()),
  };
}
