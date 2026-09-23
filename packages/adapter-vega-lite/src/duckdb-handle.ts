import { type VacpActionDescriptor, type VacpRef } from '@vacp/protocol';
import type { VacpDuckDbTableMetadata } from '@vacp/data-duckdb';
import {
  createDuckDbDataSqlHandler,
  createDuckDbWasmClient,
  getDuckDbTableMetadata,
  makeVacpDuckDbTableName,
} from '@vacp/data-duckdb';
import { registerVacpDataSchemaAction, registerVacpDataSqlAction, type VacpActionRegistry } from '@vacp/runtime';

import { whereClauseForCurrentSelections } from './duckdb-selection';
import { collectMonthdateDerivedFields, normalizeDataRows } from './data-rows';
import {
  collectSelectionFields,
  collectSpecDataSources,
  resolveDatasetNameByIndex,
  selectRowsFromView,
  scoreDataRows,
  type SpecDataSource,
} from './data-sources';
import { makeRef } from './refs';
import type { VegaLiteProviderOptions, VegaLiteSpecLike, VegaViewLike } from './types';

export type VegaLiteDuckDbDataHandle = {
  ref: VacpRef;
  tableName: string;
  title: string;
  sourceId: string;
  fields: () => ReadonlySet<string>;
  ensureMetadata: () => Promise<VacpDuckDbTableMetadata | null>;
};

/**
 * Optional DuckDB-backed DataHandles for Vega-Lite specs.
 *
 * This keeps DuckDB "first class" without requiring any additional data APIs:
 * - providers expose one semantic action: `vacp.data_sql`
 * - inspector and transports can query selection state with SQL only
 */
export function createVegaLiteDataBinding(args: {
  spec: VegaLiteSpecLike;
  view: VegaViewLike;
  options: VegaLiteProviderOptions;
  actionRegistry: VacpActionRegistry;
  actionDescriptors: VacpActionDescriptor[];
  getHoverFields?: () => Readonly<Record<string, unknown>> | null;
}): { handles: VegaLiteDuckDbDataHandle[]; dispose: () => Promise<void> } {
  const { spec, view, options, actionRegistry, actionDescriptors } = args;

  const enableDuckDb = options.enableDuckDbDataHandle ?? true;

  if (!enableDuckDb) return { handles: [], dispose: async () => {} };

  let disposeClient = async (): Promise<void> => {};
  const duckdbPromise = options.duckdbClient
    ? Promise.resolve(options.duckdbClient)
    : createDuckDbWasmClient({ log: false }).then((client) => {
        disposeClient = () => client.dispose();
        return client;
      });
  const base = `vacp_vl_${options.appId}_${options.viewId}_${options.vizId}`;

  const sources = collectSpecDataSources(spec);
  const fallback = sources.length === 0;
  const monthdateDerivations = collectMonthdateDerivedFields(spec);

  const sourcesWithDatasets: Array<SpecDataSource & { datasetName: string | null }> = fallback
    ? [
        {
          key: 'fallback',
          id: 'main',
          title: 'data',
          datasetName: null,
        } satisfies SpecDataSource & {
          datasetName: string | null;
        },
      ]
    : sources.map((s, i) => ({ ...s, datasetName: resolveDatasetNameByIndex(view, i) }));

  // Pick a "primary" source to keep `/data/main` consistent across Vega-Lite views.
  const requiredFields = collectSelectionFields(spec);

  const primaryIndex = (() => {
    let best = 0;
    let bestScore = -Infinity;
    sourcesWithDatasets.forEach((s, i) => {
      if (!s.datasetName || typeof view.data !== 'function') return;
      let rows: unknown[] | null = null;

      try {
        const r = view.data(s.datasetName);

        if (Array.isArray(r)) rows = r;
      } catch {
        rows = null;
      }

      const score = scoreDataRows(rows, requiredFields);

      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });

    return best;
  })();

  const handlesInternal: Array<
    VegaLiteDuckDbDataHandle & {
      ensureDuckDbData: () => Promise<void>;
      dispose: () => Promise<void>;
    }
  > = [];

  sourcesWithDatasets.forEach((s, idx) => {
    const suffix = idx === primaryIndex ? '/data/main' : `/data/src/${s.id}`;

    const handleRef = makeRef({
      appId: options.appId,
      viewId: options.viewId,
      vizId: options.vizId,
      suffix,
    });

    const tableName = makeVacpDuckDbTableName({ prefix: base, parts: [s.id] });
    let disposed = false;
    let tableTouched = false;
    let loadedRevision: string | null = null;
    let metadata: { revision: string | null; value: VacpDuckDbTableMetadata } | null = null;
    let loading: Promise<void> = Promise.resolve();
    let fields: ReadonlySet<string> = new Set();

    const readCurrentDataRows = (): unknown[] => {
      if (s.datasetName && typeof view.data === 'function') {
        const rows = view.data(s.datasetName);
        if (Array.isArray(rows)) return rows;
      }
      return s.values ?? (fallback ? selectRowsFromView(spec, view) : null) ?? [];
    };

    // Rows are normalized and serialized again only when Vega reports a dataset change.
    let dataVersion = 0;
    const onData = () => {
      dataVersion++;
    };
    const { datasetName } = s;
    const listening = (() => {
      if (!datasetName || !view.addDataListener || !view.removeDataListener) return false;
      try {
        view.addDataListener(datasetName, onData);
        return true;
      } catch {
        // Without a native witness every read serializes the rows it loads.
        return false;
      }
    })();
    const witnessed = listening || (!datasetName && !!s.values);
    let prepared: { version: number; rows: Record<string, unknown>[]; revision: string } | undefined;
    const currentRows = () => {
      if (witnessed && prepared?.version === dataVersion) return prepared;
      const rows = normalizeDataRows(readCurrentDataRows(), monthdateDerivations);
      prepared = { version: dataVersion, rows, revision: JSON.stringify(rows) };
      return prepared;
    };

    const ensureDuckDbData = (): Promise<void> => {
      if (disposed) return Promise.reject(new Error('Vega-Lite data handle is disposed'));
      const { rows, revision } = currentRows();
      if (!rows.length)
        return Promise.reject(new Error(`No Vega-Lite rows available to load into DuckDB (${s.title})`));
      // Serialize table replacement. Compare after the previous write so failed loads can be retried.
      const next = loading.then(async () => {
        if (revision === loadedRevision) return;
        const db = await duckdbPromise;
        loadedRevision = null;
        fields = new Set();
        tableTouched = true;
        await db.exec(`DROP TABLE IF EXISTS main.${tableName}`);
        await db.loadObjectsAsTable(tableName, rows, { create: true });
        loadedRevision = revision;
        fields = new Set(rows.flatMap((row) => Object.keys(row)));
      });
      loading = next.catch(() => {});
      return next;
    };

    const ensureMetadata = async (): Promise<VacpDuckDbTableMetadata | null> => {
      try {
        await ensureDuckDbData();
        const revision = loadedRevision;
        if (metadata?.revision === revision) return metadata.value;
        const value = await getDuckDbTableMetadata({
          duckdb: await duckdbPromise,
          table: tableName,
          sampleRows: 0,
          maxNumericColumns: 0,
          maxTemporalColumns: 0,
          maxCategoricalColumns: 0,
        });
        metadata = { revision, value };
        return value;
      } catch {
        return null;
      }
    };

    handlesInternal.push({
      ref: handleRef,
      tableName,
      title: s.title,
      sourceId: s.id,
      ensureDuckDbData,
      fields: () => fields,
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        if (listening && datasetName) view.removeDataListener!(datasetName, onData);
        prepared = undefined;
        await loading;
        if (tableTouched) await (await duckdbPromise).exec(`DROP TABLE IF EXISTS main.${tableName}`);
      },
      ensureMetadata,
    });
  });

  // Put the primary `/data/main` handle first so tools (and tests) that pick the
  // "first DataHandle" consistently get the intended main dataset.
  handlesInternal.sort((a, b) => {
    const aMain = a.ref.endsWith('/data/main');
    const bMain = b.ref.endsWith('/data/main');

    if (aMain !== bMain) return aMain ? -1 : 1;

    return a.ref.localeCompare(b.ref);
  });

  const handlesByRef = new Map(handlesInternal.map((h) => [h.ref, h] as const));

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
        const allSql = `SELECT * FROM ${handle.tableName}`;
        const where = whereClauseForCurrentSelections(spec, view, handle.fields(), args.getHoverFields?.() ?? null);
        const selectedSql = where ? `SELECT * FROM ${handle.tableName} WHERE ${where}` : allSql;

        return { allSql, selectedSql };
      },
    }),
    {
      inputRefs: handlesInternal
        .flatMap((handle) => (handle.ref.endsWith('/data/main') ? [handle.ref] : []))
        .slice(0, 1),
      enabled: options.enableSql ?? true,
      description: 'Query the current Vega-Lite selection using DuckDB SQL.',
    },
  );

  if (dataSqlDesc) actionDescriptors.push(dataSqlDesc);

  const dataSchemaDesc = registerVacpDataSchemaAction(
    actionRegistry,
    async (params) => {
      const handle = handlesByRef.get(params.handleRef);

      if (!handle) throw new Error(`Unknown DataHandle: ${params.handleRef}`);

      await handle.ensureDuckDbData();
      const db = await duckdbPromise;

      const detail = params.detail ?? 'columns';
      const sampleRows = params.sampleRows;

      const meta = await getDuckDbTableMetadata({
        duckdb: db,
        table: handle.tableName,
        sampleRows: detail === 'full' ? (sampleRows ?? 25_000) : 0,
        maxNumericColumns: detail === 'full' ? undefined : 0,
        maxTemporalColumns: detail === 'full' ? undefined : 0,
        maxCategoricalColumns: detail === 'full' ? undefined : 0,
      });

      return { handleRef: params.handleRef, detail, ...meta };
    },
    {
      inputRefs: handlesInternal
        .flatMap((handle) => (handle.ref.endsWith('/data/main') ? [handle.ref] : []))
        .slice(0, 1),
      description: 'Return DuckDB schema/metadata for a Vega-Lite DataHandle (columns, types, and optional summaries).',
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
