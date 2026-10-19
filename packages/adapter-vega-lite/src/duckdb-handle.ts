import type { VacpClock, VacpDataSchemaColumn, VacpRef } from '@ethivia/vacp-protocol';
import {
  createDuckDbDataSchemaHandler,
  createDuckDbDataSqlHandler,
  describeDuckDbColumns,
  makeVacpDuckDbTableName,
  type VacpDuckDbClient,
  type VacpDuckDbLoadType,
} from '@ethivia/vacp-duckdb';
import {
  registerVacpDataSchemaAction,
  registerVacpDataSqlAction,
  type VacpActionRegistry,
} from '@ethivia/vacp-runtime';

import type { VegaLiteBindings } from './bindings';
import { tableRows, type TableRows } from './data-rows';
import { collectSelectionFields, describeSource, scoreDataRows } from './data-sources';
import { hoverRule, whereClauseForCurrentSelections } from './duckdb-selection';
import { makeRef } from './refs';
import type { VegaLiteProviderOptions, VegaLiteSpecLike, VegaViewLike } from './types';

export type VegaLiteDuckDbDataHandle = {
  ref: VacpRef;
  /** The rows the chart's marks read, which `vacp_handle` narrows by selection and hover. */
  tableName: string;
  /** Every row the source loaded, before the chart's filters and aggregates, which `vacp_all` reads. */
  allTableName: string;
  title: string;
  /** `vacp_handle`'s WHERE clause for the current selections and hover, or null when nothing narrows it. */
  selectionWhere: () => string | null;
  /**
   * The rows the marks read now, and the table's columns, which load the table only when its
   * columns changed and resolve null when it cannot load.
   */
  observe: () => { rowCount: number; columns: Promise<VacpDataSchemaColumn[] | null> };
};

/** Replace `table` with rows, typing the columns that hold instants as TIMESTAMP and numbers as DOUBLE. */
async function loadTable(db: VacpDuckDbClient, table: string, { rows, timestamps, numbers }: TableRows) {
  const types: Record<string, VacpDuckDbLoadType> = {};
  for (const column of timestamps.keys()) types[column] = 'TIMESTAMP';
  for (const column of numbers) types[column] = 'DOUBLE';
  await db.exec(`DROP TABLE IF EXISTS main.${table}`);
  await db.loadObjectsAsTable(table, rows, { types });
}

/** A key that changes when the loaded columns or their load types do. */
const schemaOf = ({ columns, timestamps, numbers }: TableRows) =>
  JSON.stringify([[...columns].sort(), [...timestamps.keys()].sort(), [...numbers].sort()]);

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
  data: { duckdb: VacpDuckDbClient | Promise<VacpDuckDbClient>; sql?: boolean } | undefined;
  getHoverFields?: () => Readonly<Record<string, unknown>> | null;
}): { handles: VegaLiteDuckDbDataHandle[]; dispose: () => Promise<void> } {
  const { spec, view, bindings, options, actionRegistry } = args;

  if (!args.data) return { handles: [], dispose: async () => {} };
  const duckdbPromise = Promise.resolve(args.data.duckdb);
  const base = `vacp_vl_${options.appId}_${options.viewId}_${options.vizId}`;
  const { sources } = bindings.dataflow;

  const shownRows = (dataset: string): unknown[] => {
    try {
      const rows = view.data(dataset);
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
    /** The schema of the rows the table holds, and the columns read for it. */
    let loadedSchema: string | null = null;
    let described: { schema: string; columns: VacpDataSchemaColumn[] } | null = null;
    let loading: Promise<void> = Promise.resolve();
    let fields: ReadonlySet<string> = new Set();
    let timestamps: ReadonlyMap<string, VacpClock> = new Map();
    let loadedColumns = false;
    /** The source's loaded rows' columns, which an emptied `vacp_handle` takes before its first rows. */
    let loadedAll: TableRows | undefined;

    // Rows are normalized again only when Vega reports a dataset change, and its change count names them.
    let dataVersion = 0;
    const onData = () => {
      dataVersion++;
    };
    const listening = (() => {
      try {
        view.addDataListener(source.shown, onData);
        return true;
      } catch {
        // Without a native witness every read normalizes the rows and names them by their content.
        return false;
      }
    })();
    type Prepared = Omit<TableRows, 'rows'> & {
      version: number;
      revision: string;
      rowCount: number;
      schema: string;
      /** Released once loaded, since the table then holds them. */
      rows?: TableRows['rows'];
    };
    let prepared: Prepared | undefined;
    const currentRows = (): Prepared => {
      if (listening && prepared?.version === dataVersion) return prepared;
      const table = tableRows(shownRows(source.shown), source);
      prepared = {
        ...table,
        version: dataVersion,
        revision: listening ? `v${dataVersion}` : JSON.stringify(table.rows),
        rowCount: table.rows.length,
        schema: schemaOf(table),
      };
      return prepared;
    };

    const ensureDuckDbData = (): Promise<void> => {
      if (disposed) return Promise.reject(new Error('Vega-Lite data handle is disposed'));
      const current = currentRows();
      const input = source.transformed ? bindings.datasetInput(source.dataset) : null;
      if (source.transformed && !input)
        return Promise.reject(new Error(`Vega-Lite dataset ${source.dataset} has not loaded its source rows`));
      // A source with no rows at all leaves nothing to take columns from.
      if (!current.rowCount && !input?.length && !loadedColumns)
        return Promise.reject(new Error(`No Vega-Lite rows available to load into DuckDB (${title})`));
      // Serialize table replacement. Compare after the previous write so failed loads can be retried.
      const next = loading.then(async () => {
        const db = await duckdbPromise;
        // Vega replaces a dataset's input collection when its source changes, so identity is the witness.
        if (input && input !== loadedInput) {
          loadedInput = null;
          tableTouched = true;
          loadedAll = tableRows(input, source);
          await loadTable(db, allTableName, loadedAll);
          loadedAll.rows.length = 0;
          loadedInput = input;
        }
        if (current.revision !== loadedRevision) {
          loadedRevision = null;
          tableTouched = true;
          if (current.rows?.length) {
            fields = new Set();
            await loadTable(db, tableName, current as TableRows);
            fields = current.columns;
            timestamps = current.timestamps;
            loadedSchema = current.schema;
            loadedColumns = true;
          } else if (loadedColumns) await db.exec(`DELETE FROM main.${tableName}`);
          else {
            // A filter can leave the marks no rows before any loaded. The table takes the source's columns.
            await db.exec(`CREATE OR REPLACE TABLE main.${tableName} AS SELECT * FROM main.${allTableName} LIMIT 0`);
            fields = loadedAll!.columns;
            timestamps = loadedAll!.timestamps;
            loadedSchema = schemaOf(loadedAll!);
            loadedColumns = true;
          }
          loadedRevision = current.revision;
          delete current.rows;
        }
      });
      loading = next.catch(() => {});
      return next;
    };

    return {
      ref,
      tableName,
      allTableName,
      title,
      ensureDuckDbData,
      selectionWhere: () =>
        whereClauseForCurrentSelections(spec, view, { names: fields, timestamps }, args.getHoverFields?.() ?? null),
      observe: () => {
        const current = currentRows();
        if (described?.schema === current.schema)
          return { rowCount: current.rowCount, columns: Promise.resolve(described.columns) };
        // Columns are read after the load that sets them, in the same queue, so they match the table.
        const columns = ensureDuckDbData().then(() => {
          const next = loading.then(async () => {
            if (described?.schema !== loadedSchema) {
              const columns = await describeDuckDbColumns({ duckdb: await duckdbPromise, table: tableName });
              described = { schema: loadedSchema!, columns };
            }
            return described!.columns;
          });
          loading = next.then(
            () => {},
            () => {},
          );
          return next;
        });
        return { rowCount: current.rowCount, columns: columns.catch(() => null) };
      },
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        if (listening) view.removeDataListener(source.shown, onData);
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

  if (args.data.sql ?? true)
    registerVacpDataSqlAction(
      actionRegistry,
      createDuckDbDataSqlHandler({
        duckdb: duckdbPromise,
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
        description: `Query the chart data with DuckDB SQL. ${hoverRule} \`vacp_all\` holds every row the source loaded.`,
      },
    );

  registerVacpDataSchemaAction(
    actionRegistry,
    createDuckDbDataSchemaHandler({
      duckdb: duckdbPromise,
      resolveHandle: async (ref) => {
        const handle = handlesByRef.get(ref);
        if (!handle) return null;
        await handle.ensureDuckDbData();
        return { table: handle.tableName, allTable: handle.allTableName };
      },
    }),
    {
      inputRefs,
      description:
        'Return the columns, types, and row count of a Vega-Lite DataHandle, for `vacp_handle` and, when the chart transforms its source, for `vacp_all`.',
    },
  );

  let disposal: Promise<void> | undefined;
  return {
    handles: handlesInternal,
    dispose: () =>
      (disposal ??= (async () => {
        const results = await Promise.allSettled(handlesInternal.map((handle) => handle.dispose()));
        await duckdbPromise;
        const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
        if (errors.length) throw new AggregateError(errors, 'Failed to release Vega-Lite data tables');
      })()),
  };
}
