export type VacpDuckDbQueryClient = {
  exec(sql: string): Promise<void>;
  queryJson(sql: string): Promise<{ columns: string[]; rows: Record<string, unknown>[] }>;
  queryArrowIpcBase64(sql: string): Promise<string>;
};

export type VacpDuckDbClient = VacpDuckDbQueryClient & {
  /**
   * Load rows into `tableName`. Columns in `types` hold text that loads with that type: wall-clock
   * text such as `2012-06-01T00:00:00.000` as TIMESTAMP, and decimal text such as `24999.5` as DOUBLE.
   * Other columns take the types DuckDB's JSON reader infers.
   */
  loadObjectsAsTable(
    tableName: string,
    rows: Record<string, unknown>[],
    options?: { types?: Readonly<Record<string, VacpDuckDbLoadType>> },
  ): Promise<void>;
};

/** A column type `loadObjectsAsTable` casts text to. */
export type VacpDuckDbLoadType = 'TIMESTAMP' | 'DOUBLE';
