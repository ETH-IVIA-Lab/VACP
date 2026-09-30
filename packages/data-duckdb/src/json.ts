import { formatVacpWallClock, type JsonObject, type JsonScalar, type JsonValue } from '@vacp/protocol';
import { Type } from 'apache-arrow';

type SqlRecord = { [key: string]: SqlValue };

type SqlList = { toArray(): ArrayLike<SqlValue> };

type SqlStruct = { toJSON(): SqlRecord };

type SqlValue = JsonScalar | bigint | Date | Uint8Array | SqlValue[] | SqlRecord | SqlList | SqlStruct;

type ArrowTableView = {
  schema: { fields: readonly { name: string; type: { typeId: Type; timezone?: string | null } }[] };
  numRows: number;
  getChild(name: string): { get(index: number): SqlValue } | null;
};

type ColumnType = ArrowTableView['schema']['fields'][number]['type'];

/**
 * How a temporal column's cells read in JSON. Arrow returns DATE and TIMESTAMP cells as epoch
 * milliseconds: a DATE reads as its day, a TIMESTAMP as its wall-clock time, and a TIMESTAMP WITH
 * TIME ZONE as an ISO instant.
 */
function temporalText(type: ColumnType): ((time: number) => string) | undefined {
  if (type.typeId === Type.Date) return (time) => new Date(time).toISOString().slice(0, 10);
  if (type.typeId !== Type.Timestamp) return undefined;
  return type.timezone ? (time) => new Date(time).toISOString() : (time) => formatVacpWallClock(time, 'utc');
}

function reader(type: ColumnType): (value: SqlValue) => JsonValue {
  const text = temporalText(type);
  if (!text) return sanitize;
  return (value) => {
    const time = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Number.NaN;
    return Number.isFinite(time) ? text(time) : sanitize(value);
  };
}

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
  const readers = table.schema.fields.map((field) => reader(field.type));

  const vectors = columns.map((column) => table.getChild(column));
  const rows: JsonObject[] = Array.from({ length: table.numRows }, (_, index) =>
    Object.fromEntries(columns.map((column, at) => [column, readers[at]!(vectors[at]?.get(index))])),
  );

  return { columns, rows };
}
