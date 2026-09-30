import { duckDBCodeGenerator, isNode } from '@uwdata/mosaic-sql';

import { markTable } from './data-handles';
import type { VgplotPlotLike, VgplotSelectionLike, VgplotTableLike } from './types';

function exprToSql(expr: unknown): string | null {
  if (expr === true) return 'true';

  if (expr === false) return 'false';

  if (typeof expr === 'string') return expr;

  if (isNode(expr)) return duckDBCodeGenerator.toString(expr);

  return null;
}

function predicateToSql(predicate: unknown): string | null {
  if (predicate === undefined || predicate === null) return null;

  if (Array.isArray(predicate)) {
    const parts = predicate.map(exprToSql).filter((x): x is string => !!x);

    if (!parts.length) return null;

    return normalizeDuckDbPredicate(parts.map((p) => `(${p})`).join(' AND '));
  }

  const one = exprToSql(predicate);

  return one ? normalizeDuckDbPredicate(`(${one})`) : null;
}

function normalizeDuckDbPredicate(sql: string): string {
  /**
   * Heuristic normalization for VGPlot-generated predicates.
   *
   * Some VGPlot selections compare a DATE-valued expression against epoch-ms
   * bounds (e.g. `make_date(...) BETWEEN 1333... AND 1349...`). DuckDB will
   * not interpret that as intended. Convert the left-hand side to epoch ms.
   */
  const marker = 'make_date(';
  let out = '';
  let i = 0;

  while (i < sql.length) {
    const idx = sql.indexOf(marker, i);

    if (idx < 0) {
      out += sql.slice(i);
      break;
    }

    out += sql.slice(i, idx);

    // Find the closing paren for this make_date(...) call.
    let j = idx + marker.length;
    let depth = 1;

    while (j < sql.length && depth > 0) {
      const ch = sql[j];

      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      j += 1;
    }

    if (depth !== 0) {
      out += sql.slice(idx);
      break;
    }

    const call = sql.slice(idx, j); // includes closing ')'
    const rest = sql.slice(j);
    const m = rest.match(/^\s+BETWEEN\s+(\d{13,})\s+AND\s+(\d{13,})/);

    if (m) {
      out += `epoch_ms(${call})`;
      i = j;
      continue;
    }

    out += call;
    i = j;
  }

  return out;
}

/**
 * The predicate that narrows `table` as the dashboard narrows it: the whole predicate of each
 * selection that filters a mark or table view reading `table`, as Mosaic's `filterBy`. Selections
 * that only highlight, or that filter views of other tables, leave `table` alone.
 */
export function whereClauseForVgplotTable(
  table: string,
  surfaces: { plots: readonly VgplotPlotLike[]; tables: readonly VgplotTableLike[] },
): string | null {
  const selections = new Set<VgplotSelectionLike>();
  for (const plot of surfaces.plots)
    for (const mark of plot.marks) if (mark.filterBy && markTable(mark) === table) selections.add(mark.filterBy);
  for (const view of surfaces.tables) if (view.filterBy && view.from === table) selections.add(view.filterBy);
  const clauses = [...selections].flatMap((selection) => {
    try {
      // The whole predicate, since `vacp_handle` holds the rows of every view reading the table.
      const sql = predicateToSql(selection.predicate?.(undefined, true));
      return sql ? [sql] : [];
    } catch {
      return [];
    }
  });
  return clauses.length ? clauses.map((clause) => `(${clause})`).join(' AND ') : null;
}

export function quoteTableRef(table: string): string {
  // Quote dot-separated identifiers (schema.table).
  return table
    .split('.')
    .map((p) => `"${p.replaceAll('"', '""')}"`)
    .join('.');
}
