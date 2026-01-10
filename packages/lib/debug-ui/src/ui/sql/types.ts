export type NormalizedSQLType =
  | 'float'
  | 'decimal'
  | 'integer'
  | 'bigint'
  | 'boolean'
  | 'date'
  | 'timestamp'
  | 'timestamptz'
  | 'time'
  | 'timetz'
  | 'interval'
  | 'string'
  | 'bytes'
  | 'bitstring'
  | 'array'
  | 'object'
  | 'other';

export type SqlResultColumn = {
  name: string;
  sqlType: NormalizedSQLType;
  databaseType: string;
  nullable: boolean;
};

export type SqlResultTableModel = {
  columns: SqlResultColumn[];
  rows: Record<string, unknown>[];
  truncated: boolean;
};
