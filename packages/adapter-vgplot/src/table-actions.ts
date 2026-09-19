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

async function refreshTable(table: VgplotTableLike, offset = 0): Promise<void> {
  if (table.requestData) {
    await table.requestData(offset);
    const result = await table.pending;
    if (result instanceof Error) throw result;
    // Mosaic resets offset when replacing a batch. Preserve the requested page for subsequent scrolling.
    table.offset = offset;
  } else await table.update?.();
}

function updateSortHeader(table: VgplotTableLike): void {
  if (table.sortHeader?.firstChild) table.sortHeader.firstChild.textContent = '';
  const index = table.schema?.findIndex((field) => field.column === table.sortColumn) ?? -1;
  const header = index >= 0 ? table.element?.querySelectorAll<HTMLElement>('thead th')[index] : undefined;
  table.sortHeader = header ?? null;
  if (header?.firstChild) header.firstChild.textContent = table.sortDesc ? '▾' : '▴';
}

export function prepareTableAction(table: VgplotTableLike, call: { name: string; params?: unknown }) {
  const params = (call.params ?? {}) as Record<string, unknown>;

  if (call.name === 'vgplot.table_set_sort') {
    const column = readString(params.column);

    if (!column) throw new Error('column must be a non-empty string');
    if (table.schema?.length && !table.schema.some((field) => field.column === column))
      throw new Error(`Unknown table column: ${column}`);
    const desc = Boolean(params.desc);
    return async () => {
      table.sortColumn = column;
      table.sortDesc = desc;
      updateSortHeader(table);
      await refreshTable(table);

      return { sorted: true, column, desc };
    };
  }

  if (call.name === 'vgplot.table_clear_sort')
    return async () => {
      table.sortColumn = null;
      table.sortDesc = false;
      updateSortHeader(table);
      await refreshTable(table);

      return { sorted: false };
    };

  if (call.name === 'vgplot.table_set_page') {
    const offset = params.offset === undefined ? null : readNumber(params.offset);
    const limit = params.limit === undefined ? null : readNumber(params.limit);
    if (params.offset !== undefined && offset === null) throw new Error('offset must be finite');
    if (params.limit !== undefined && limit === null) throw new Error('limit must be finite');

    return async () => {
      if (offset !== null) table.offset = Math.max(0, Math.floor(offset));

      if (limit !== null) table.limit = Math.max(1, Math.floor(limit));
      await refreshTable(table, table.offset ?? 0);

      return { paged: true, offset: table.offset ?? 0, limit: table.limit ?? null };
    };
  }

  throw new Error(`Unsupported table action: ${call.name}`);
}

export function sqlForVgplotTableView(args: {
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

  const limit =
    typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.max(1, Math.floor(args.limit)) : null;

  const offset =
    typeof args.offset === 'number' && Number.isFinite(args.offset) ? Math.max(0, Math.floor(args.offset)) : null;

  if (limit !== null) clauses.push(`LIMIT ${limit}`);

  if (offset !== null && offset > 0) clauses.push(`OFFSET ${offset}`);

  const selectedSql = clauses.length ? `SELECT * FROM ${table} ${clauses.join(' ')}` : allSql;

  return { allSql, selectedSql };
}
