export type { VacpDuckDbClient, VacpDuckDbWasmClient } from './client.js';

export { createDuckDbWasmClient } from './client.js';

export { createDuckDbDataSqlHandler } from './data-sql.js';

export type { VacpDuckDbTableMetadata, VacpDuckDbColumnInfo } from './metadata.js';

export { getDuckDbTableMetadata } from './metadata.js';

export { formatDuckDbTableMetadataSummary } from './summary.js';

export { makeVacpDuckDbTableName } from './table-name.js';

export { normalizeSingleStatementSql, sqlIdentifier, sqlStringLiteral } from './sql.js';

export { createDuckDbSqlRouter } from './router.js';

export type { VacpDuckDbHandleSpec } from './router.js';
