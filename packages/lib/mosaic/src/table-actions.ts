import type { VgplotTableLike } from './types';

function quoteIdent(part: string): string {
  return `"${part.replaceAll('"', '""')}"`;
}

function quoteTableRef(table: string): string {
  return table
    .split('.')
    .map((p) => quoteIdent(p))
    .join('.');
}

function readString(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

function readNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

async function refreshTable(table: VgplotTableLike): Promise<void> {
  try {
    if (typeof table.requestData === 'function') await table.requestData();
  } finally {
    if (typeof table.update === 'function') table.update();
  }
}

export async function executeTableAction(
  table: VgplotTableLike,
  call: { name: string; params?: unknown },
): Promise<unknown> {
  const params = (call.params ?? {}) as Record<string, unknown>;

  if (call.name === 'mosaic.table_set_sort') {
    const column = readString(params.column);
    if (!column) throw new Error('column must be a non-empty string');
    const desc = Boolean(params.desc);
    table.sortColumn = column;
    table.sortDesc = desc;
    await refreshTable(table);
    return { sorted: true, column, desc };
  }

  if (call.name === 'mosaic.table_clear_sort') {
    table.sortColumn = null;
    table.sortDesc = false;
    await refreshTable(table);
    return { sorted: false };
  }

  if (call.name === 'mosaic.table_set_page') {
    const offset = params.offset === undefined ? null : readNumber(params.offset);
    const limit = params.limit === undefined ? null : readNumber(params.limit);
    if (offset !== null) table.offset = Math.max(0, Math.floor(offset));
    if (limit !== null) table.limit = Math.max(1, Math.floor(limit));
    await refreshTable(table);
    return { paged: true, offset: table.offset ?? 0, limit: table.limit ?? null };
  }

  throw new Error(`Unsupported table action: ${call.name}`);
}

export function sqlForMosaicTableView(args: {
  tableName: string;
  where?: string | null;
  sortColumn?: string | null;
  sortDesc?: boolean;
  offset?: number | null;
  limit?: number | null;
}): { allSql: string; selectedSql: string } {
  const table = quoteTableRef(args.tableName);
  const allSql = `SELECT * FROM ${table}`;

  const clauses: string[] = [];
  if (args.where) clauses.push(`WHERE ${args.where}`);

  const sortCol = readString(args.sortColumn);
  const orderBy = sortCol ? `ORDER BY ${quoteIdent(sortCol)} ${args.sortDesc ? 'DESC' : 'ASC'}` : null;
  if (orderBy) clauses.push(orderBy);

  const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.max(1, Math.floor(args.limit)) : null;
  const offset = typeof args.offset === 'number' && Number.isFinite(args.offset) ? Math.max(0, Math.floor(args.offset)) : null;
  if (limit !== null) clauses.push(`LIMIT ${limit}`);
  if (offset !== null && offset > 0) clauses.push(`OFFSET ${offset}`);

  const selectedSql = clauses.length ? `SELECT * FROM ${table} ${clauses.join(' ')}` : allSql;
  return { allSql, selectedSql };
}

