import { exampleDuckDbBundles } from '@vacp/example-shared';
import { registerVacpDataSchemaAction, registerVacpDataSqlAction } from '@vacp/runtime';
import type { VacpActions } from '@vacp/sdk';
import {
  createDuckDbDataSchemaHandler,
  createDuckDbDataSqlHandler,
  createDuckDbWasmClient,
  describeDuckDbTable,
  makeVacpDuckDbTableName,
  sqlStringLiteral,
} from '@vacp/data-duckdb';
import type { VacpDataHandleData, VacpDataSchemaColumn } from '@vacp/protocol';
import type { DatasetId } from '../datasets/registry';
import type { DashboardSnapshot, ReactDashboardModel } from './model';
import { dashboardRefs } from './refs';

/** The selected points as a predicate over the dataset's `id` column, or null when none are selected. */
export function selectionWhere({ dataset, selectedIds }: DashboardSnapshot): string | null {
  if (!dataset || !selectedIds.length) return null;
  return `id IN (${selectedIds.map(sqlStringLiteral).join(', ')})`;
}

export function createDashboardData(actions: VacpActions, model: ReactDashboardModel, enableSql: boolean) {
  const { handleRef } = dashboardRefs;
  // One DuckDB table holds the active dataset.
  const duckdb = createDuckDbWasmClient({ log: false, bundles: exampleDuckDbBundles });
  const tableName = makeVacpDuckDbTableName({ prefix: 'vacp_react_dashboard_rows' });
  let columns: VacpDataSchemaColumn[] | undefined;
  let loadedDatasetId: DatasetId | null = null;
  let duckDbLoad: Promise<void> | null = null;

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
        await db.loadObjectsAsTable(tableName, dataset.rows, {});
        columns = (await describeDuckDbTable({ duckdb: db, table: tableName }).catch(() => null))?.columns;

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

  const sql = createDuckDbDataSqlHandler({
    duckdb,
    resolveHandle: async (ref) => {
      if (ref !== handleRef) return null;
      await ensureDuckDbLoaded();
      const allSql = `SELECT * FROM ${tableName}`;
      const where = selectionWhere(model.read());
      return { allSql, selectedSql: where ? `${allSql} WHERE ${where}` : allSql };
    },
  });
  if (enableSql)
    registerVacpDataSqlAction(actions.registry, sql, {
      availability: { requires: [handleRef] },
      inputRefs: [handleRef],
      description: 'Query the current dataset via DuckDB SQL.',
    });

  registerVacpDataSchemaAction(
    actions.registry,
    createDuckDbDataSchemaHandler({
      duckdb,
      resolveHandle: async (ref) => {
        if (ref !== handleRef) return null;
        await ensureDuckDbLoaded();
        return { table: tableName };
      },
    }),
    {
      availability: { requires: [handleRef] },
      inputRefs: [handleRef],
      description: 'Return the columns, types, and row count of the current dataset.',
    },
  );

  return {
    /** The table the dataset loads into, with its columns once `datasetId` has loaded. */
    describe(datasetId: DatasetId | null): VacpDataHandleData {
      return datasetId === loadedDatasetId && columns ? { table: tableName, columns } : { table: tableName };
    },
    dispose() {
      void duckdb.then((db) => db.dispose()).catch((error) => console.error('Dashboard data cleanup failed', error));
    },
  };
}
