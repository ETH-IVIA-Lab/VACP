// @ethivia/vacp-sdk/data: data handles, and SQL over any DuckDB client for the vacp.data_sql and vacp.data_schema operations.
export { registerVacpDataSchemaAction, registerVacpDataSqlAction } from '../runtime';
export {
  formatVacpWallClock,
  type JsonObject,
  type JsonScalar,
  type JsonValue,
  parseVacpInstant,
  type VacpClock,
  vacpDataHandle,
  type VacpDataHandleData,
  type VacpDataHandleDescriber,
  type VacpDataHandleState,
  type VacpDataSchemaColumn,
  type VacpDataSchemaResult,
} from '../protocol';
export {
  countDuckDbTablesOnce,
  createDuckDbDataSchemaHandler,
  createDuckDbDataSqlHandler,
  describeDuckDbColumns,
  describeDuckDbTable,
  makeVacpDuckDbTableName,
  normalizeSingleStatementSql,
  sqlIdentifier,
  sqlStringLiteral,
  sqlTimestampLiteral,
  type VacpDuckDbClient,
  type VacpDuckDbLoadType,
  type VacpDuckDbQueryClient,
} from '../data';
