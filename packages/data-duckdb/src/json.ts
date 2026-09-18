import { type JsonScalar, type JsonObject, type JsonValue } from '@vacp/protocol';

type SqlRecord = { [key: string]: SqlValue };

type SqlList = { toArray(): ArrayLike<SqlValue> };

type SqlStruct = { toJSON(): SqlRecord };

type SqlValue = JsonScalar | bigint | Date | Uint8Array | SqlValue[] | SqlRecord | SqlList | SqlStruct;

type ArrowTableView = {
  schema: { fields: readonly { name: string }[] };
  numRows: number;
  getChild(name: string): { get(index: number): SqlValue } | null;
};

function sanitize(value: SqlValue): JsonValue {
  if (typeof value === 'bigint') return value.toString();

  if (value instanceof Date) return value.toISOString();

  if (value instanceof Uint8Array) return Array.from(value);

  if (Array.isArray(value)) return value.map(sanitize);

  if (value === null || typeof value !== 'object') return value;

  if ('toArray' in value && typeof value.toArray === 'function') return Array.from(value.toArray(), sanitize);

  if ('toJSON' in value && typeof value.toJSON === 'function') return sanitize(value.toJSON());

  return Object.fromEntries(Object.entries(value).map(([key, cell]) => [key, sanitize(cell)]));
}

export function arrowTableToJson(table: ArrowTableView) {
  const columns = table.schema.fields.map((field) => field.name);

  const rows: JsonObject[] = Array.from({ length: table.numRows }, (_, index) =>
    Object.fromEntries(columns.map((column) => [column, sanitize(table.getChild(column)?.get(index))])),
  );

  return { columns, rows };
}
