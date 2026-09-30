export type { VacpDuckDbClient, VacpDuckDbLoadType, VacpDuckDbWasmClient } from './client';

export { createDuckDbWasmClient, instantiateDuckDbWasm } from './client';

export { createDuckDbDataSqlHandler } from './data-sql';

export { createDuckDbDataSchemaHandler } from './data-schema';

export { describeDuckDbTable } from './metadata';

export { countDuckDbTablesOnce } from './table-counts';

export { makeVacpDuckDbTableName } from './table-name';

export { normalizeSingleStatementSql, sqlIdentifier, sqlStringLiteral, sqlTimestampLiteral } from './sql';

export { createDuckDbSqlRouter } from './router';

export type { VacpDuckDbHandleSpec } from './router';
