import { exampleDuckDbBundles } from '@vacp/example-shared';
import type { VacpActions } from '@vacp/sdk';
import {
  createDuckDbSqlRouter,
  createDuckDbWasmClient,
  makeVacpDuckDbTableName,
  sqlStringLiteral,
  getDuckDbTableMetadata,
  type VacpDuckDbTableMetadata,
} from '@vacp/data-duckdb';
import type { DatasetId } from '../datasets/registry';
import { getEffectiveSelectedIds, type ReactDashboardModel } from './model';
import { dashboardRefs } from './refs';

export function createDashboardData(actions: VacpActions, model: ReactDashboardModel, enableSql: boolean) {
  const { handleRef } = dashboardRefs;
  // DuckDB: one table for the active dataset + a temp table for effective ids.
  const duckdb = createDuckDbWasmClient({ log: false, bundles: exampleDuckDbBundles });
  const tableName = makeVacpDuckDbTableName({ prefix: 'vacp_react_dashboard_rows' });
  let tableMeta: VacpDuckDbTableMetadata | null = null;
  let loadedDatasetId: DatasetId | null = null;
  let duckDbLoad: Promise<void> | null = null;
  const selectedIdsTable = 'vacp_react_dashboard_selected_ids';

  const ensureDuckDbLoaded = async (): Promise<void> => {
    while (true) {
      const { datasetId, dataset } = model.read();

      if (!datasetId) throw new Error('No dataset selected');

      if (!dataset) throw new Error('No dataset loaded');

      if (duckDbLoad) {
        await duckDbLoad;
        continue;
      }

      if (loadedDatasetId === datasetId) return;

      const load = (async () => {
        const db = await duckdb;
        await db.exec(`DROP TABLE IF EXISTS ${tableName}`);
        await db.loadObjectsAsTable(tableName, dataset.rows, { create: true });

        try {
          tableMeta = await getDuckDbTableMetadata({
            duckdb: db,
            table: tableName,
            sampleRows: 0,
            maxNumericColumns: 0,
            maxTemporalColumns: 0,
            maxCategoricalColumns: 0,
          });
        } catch {
          tableMeta = null;
        }

        loadedDatasetId = datasetId;
      })();

      duckDbLoad = load;

      try {
        await load;
      } finally {
        if (duckDbLoad === load) duckDbLoad = null;
      }
    }
  };

  const syncSelectedIds = async (ids: string[]): Promise<void> => {
    const db = await duckdb;
    await ensureDuckDbLoaded();
    await db.exec(`CREATE TEMP TABLE IF NOT EXISTS ${selectedIdsTable}(id VARCHAR)`);
    await db.exec(`DELETE FROM ${selectedIdsTable}`);

    if (!ids.length) return;
    const values = ids.map((id) => `(${sqlStringLiteral(id)})`).join(',');
    await db.exec(`INSERT INTO ${selectedIdsTable} VALUES ${values}`);
  };

  const sql = createDuckDbSqlRouter({ duckdb });
  sql.addHandle({
    handleRef,
    getAllSql: async () => {
      await ensureDuckDbLoaded();

      return `SELECT * FROM ${tableName}`;
    },
    getSelectedSql: async () => {
      await ensureDuckDbLoaded();
      const { ids } = getEffectiveSelectedIds(model.read());
      await syncSelectedIds(ids);

      return ids.length
        ? `SELECT t.* FROM ${tableName} t JOIN ${selectedIdsTable} s USING(id)`
        : `SELECT * FROM ${tableName}`;
    },
  });
  actions.standard.dataSql(sql.handler, {
    enabled: enableSql,
    availability: { requires: [handleRef] },
    inputRefs: [handleRef],
    description: 'Query the current dataset via DuckDB SQL.',
  });

  actions.standard.dataSchema(
    async (params) => {
      if (params.handleRef !== handleRef) throw new Error(`Unknown DataHandle: ${params.handleRef}`);
      await ensureDuckDbLoaded();
      const db = await duckdb;
      const detail = params.detail ?? 'columns';
      const sampleRows = params.sampleRows;

      const meta = await getDuckDbTableMetadata({
        duckdb: db,
        table: tableName,
        sampleRows: detail === 'full' ? (sampleRows ?? 25_000) : 0,
        maxNumericColumns: detail === 'full' ? undefined : 0,
        maxTemporalColumns: detail === 'full' ? undefined : 0,
        maxCategoricalColumns: detail === 'full' ? undefined : 0,
      });

      return { handleRef, detail, ...meta };
    },
    {
      availability: { requires: [handleRef] },
      inputRefs: [handleRef],
      description: 'Return schema/metadata for the current dataset (columns, types, row count, optional summaries).',
    },
  );

  return {
    describe(datasetId: DatasetId | null) {
      return { tableName, metadata: datasetId === loadedDatasetId ? tableMeta : null };
    },
    dispose() {
      void duckdb.then((db) => db.dispose()).catch((error) => console.error('Dashboard data cleanup failed', error));
    },
  };
}
