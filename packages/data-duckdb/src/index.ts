export type { VacpDuckDbClient, VacpDuckDbLoadType, VacpDuckDbWasmClient } from './client';

export { createDuckDbWasmClient, instantiateDuckDbWasm } from './client';

export { createDuckDbDataSqlHandler } from './data-sql';

export type { VacpDuckDbTableMetadata, VacpDuckDbColumnInfo } from './metadata';

export { getDuckDbTableMetadata } from './metadata';

export { formatDuckDbTableMetadataSummary } from './summary';

export { makeVacpDuckDbTableName } from './table-name';

export { normalizeSingleStatementSql, sqlIdentifier, sqlStringLiteral, sqlTimestampLiteral } from './sql';

export { createDuckDbSqlRouter } from './router';

export type { VacpDuckDbHandleSpec } from './router';
