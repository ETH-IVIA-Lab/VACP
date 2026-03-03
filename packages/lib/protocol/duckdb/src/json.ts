function sanitize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  Object.entries(obj).forEach(([k, v]) => {
    out[k] = sanitize(v);
  });
  return out;
}

function readRowValue(row: unknown, column: string): unknown {
  if (!row || typeof row !== 'object') return undefined;
  const rec = row as Record<string, unknown>;
  if (column in rec) return rec[column];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyRow = row as any;
  if (typeof anyRow.get === 'function') return anyRow.get(column);
  return undefined;
}

export function arrowTableToJson(table: unknown): { columns: string[]; rows: Record<string, unknown>[] } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = table as any;
  const columns: string[] = Array.isArray(t?.schema?.fields) ? t.schema.fields.map((f: any) => String(f?.name)) : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawRows: any[] = typeof t?.toArray === 'function' ? t.toArray() : [];
  const cols = columns.length ? columns : rawRows[0] ? Object.keys(rawRows[0]) : [];
  const rows = rawRows.map((r) => {
    const obj: Record<string, unknown> = {};
    cols.forEach((c) => {
      obj[c] = sanitize(readRowValue(r, c));
    });
    return obj;
  });
  return { columns: cols, rows };
}
