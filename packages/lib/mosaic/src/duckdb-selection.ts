import { duckDBCodeGenerator, isNode } from '@uwdata/mosaic-sql';

import type { CollectedInput } from './inputs';
import type { VgplotPlotLike } from './types';

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
   * Heuristic normalization for Mosaic-generated predicates.
   *
   * Some Mosaic selections compare a DATE-valued expression against epoch-ms
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

export function whereClauseForMosaicPlotSelection(plot: VgplotPlotLike): string | null {
  return whereClauseForMosaicDashboardSelection({ plots: [plot] });
}

export function whereClauseForMosaicDashboardSelection(args: {
  plots?: VgplotPlotLike[];
  inputs?: CollectedInput[];
}): string | null {
  const clauses: string[] = [];

  (args.plots ?? []).forEach((plot) => {
    plot.interactors.forEach((it) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sel = (it as any).selection as any;
      if (!sel || typeof sel.predicate !== 'function') return;
      try {
        const pred = sel.predicate(undefined, true);
        const sql = predicateToSql(pred);
        if (sql) clauses.push(sql);
      } catch {
        // ignore: if predicate fails, don't block other interactors
      }
    });
  });

  (args.inputs ?? []).forEach((input) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sel = (input.input as any).selection as any;
    if (!sel || typeof sel.predicate !== 'function') return;
    try {
      const pred = sel.predicate(undefined, true);
      const sql = predicateToSql(pred);
      if (sql) clauses.push(sql);
    } catch {
      // ignore
    }
  });

  if (!clauses.length) return null;
  return clauses.map((c) => `(${c})`).join(' AND ');
}

export function quoteTableRef(table: string): string {
  // Quote dot-separated identifiers (schema.table).
  return table
    .split('.')
    .map((p) => `"${p.replaceAll('"', '""')}"`)
    .join('.');
}
