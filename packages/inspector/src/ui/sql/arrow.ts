import { DataType, tableFromIPC, type Table } from 'apache-arrow';

import type { NormalizedSQLType, SqlResultColumn, SqlResultTableModel } from './types';

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return bytes;
}

function normalizedSqlTypeFromArrow(type: DataType): NormalizedSQLType {
  if (DataType.isInt(type)) {
    if (type.bitWidth === 64) return 'bigint';

    return 'integer';
  }

  if (DataType.isFloat(type)) return 'float';

  if (DataType.isDecimal(type)) return 'decimal';

  if (DataType.isBinary(type) || DataType.isFixedSizeBinary(type)) return 'bytes';

  if (DataType.isUtf8(type)) return 'string';

  if (DataType.isBool(type)) return 'boolean';

  if (DataType.isDate(type)) return 'date';

  if (DataType.isTime(type)) return 'time';

  if (DataType.isTimestamp(type)) return type.timezone && type.timezone.length > 0 ? 'timestamptz' : 'timestamp';

  if (DataType.isInterval(type)) return 'interval';

  if (DataType.isList(type) || DataType.isFixedSizeList(type)) return 'array';

  if (DataType.isStruct(type) || DataType.isMap(type)) return 'object';

  if (DataType.isUnion(type)) return 'other';

  if (DataType.isDictionary(type)) return normalizedSqlTypeFromArrow(type.valueType);

  return 'other';
}

export function decodeArrowIpcBase64ToTable(ipcBase64: string): Table {
  return tableFromIPC(decodeBase64(ipcBase64));
}

export function tableSchemaFromArrow(table: Table): SqlResultColumn[] {
  return table.schema.fields.map((field) => ({
    name: field.name,
    sqlType: normalizedSqlTypeFromArrow(field.type),
    nullable: field.nullable,
    databaseType: String(field.type),
  }));
}

export function tableRowsFromArrow(table: Table, columns: SqlResultColumn[], maxRows: number): SqlResultTableModel {
  const n = Math.min(table.numRows, maxRows + 1);
  const rows: Record<string, unknown>[] = [];

  const vectors = columns.map((c, i) => [c.name, table.getChildAt(i)] as const);

  for (let rowIndex = 0; rowIndex < n; rowIndex += 1) {
    const row: Record<string, unknown> = {};

    for (let colIndex = 0; colIndex < vectors.length; colIndex += 1) {
      const [name, vec] = vectors[colIndex]!;
      row[name] = vec?.get(rowIndex) ?? null;
    }

    rows.push(row);
  }

  const truncated = rows.length > maxRows;

  return { columns, rows: truncated ? rows.slice(0, maxRows) : rows, truncated };
}

export function toJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();

  if (Array.isArray(value)) return value.map(toJsonSafe);

  if (value && typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    const out: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toJsonSafe(v);

    return out;
  }

  return value;
}
