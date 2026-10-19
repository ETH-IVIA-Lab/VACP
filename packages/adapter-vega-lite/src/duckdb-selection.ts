import { readSelectionTuples } from './selection-state';
import { sqlIdentifier, sqlStringLiteral, sqlTimestampLiteral } from '@ethivia/vacp-data-duckdb';
import type { VacpClock } from '@ethivia/vacp-protocol';

import { collectVegaLiteParams } from './params';
import { vegaInstant } from './temporal';
import type { VegaLiteSpecLike, VegaViewLike } from './types';

export const hoverRule =
  '`vacp_handle` uses the hovered rows when hover is active. Otherwise the current selections narrow it.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSelect(select: unknown): Record<string, unknown> | null {
  if (typeof select === 'string') return { type: select };

  if (isRecord(select)) return select;

  return null;
}

/** The handle's loaded columns. A timestamp column compares with a TIMESTAMP on its own clock. */
export type SelectionColumns = { names: ReadonlySet<string>; timestamps: ReadonlyMap<string, VacpClock> };

function timestamp(value: unknown, column: string, clock: VacpClock, round: (time: number) => number = Math.round) {
  const time = vegaInstant(value);
  if (time === null) throw new Error(`${JSON.stringify(value)} names no instant for the date column ${column}`);
  return sqlTimestampLiteral(round(time), clock);
}

function sqlLiteral(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number' && Number.isFinite(value)) return String(value);

  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (typeof value === 'string') return sqlStringLiteral(value);

  if (typeof value === 'bigint') return sqlStringLiteral(value.toString());

  if (Array.isArray(value) || isRecord(value)) {
    try {
      return sqlStringLiteral(JSON.stringify(value));
    } catch {
      return sqlStringLiteral(Array.isArray(value) ? String(value) : Object.prototype.toString.call(value));
    }
  }

  return null;
}

function literalFor(columns: SelectionColumns, column: string) {
  const clock = columns.timestamps.get(column);
  return (value: unknown) => (clock ? timestamp(value, column, clock) : sqlLiteral(value));
}

function hoverPredicates(fields: Readonly<Record<string, unknown>> | null, columns: SelectionColumns): string[] {
  if (!isRecord(fields)) return [];

  const preds: string[] = [];

  for (const [field, value] of Object.entries(fields)) {
    if (!field) continue;

    if (!columns.names.has(field)) continue;
    const ident = sqlIdentifier(field);
    const literal = literalFor(columns, field);

    if (Array.isArray(value)) {
      const lits = value.map(literal).filter((x): x is string => x !== null);

      if (!lits.length) continue;
      preds.push(`(${ident} IN (${lits.join(', ')}))`);
      continue;
    }

    const lit = literal(value);

    if (!lit) continue;
    preds.push(`(${ident} = ${lit})`);
  }

  return preds;
}

function tuplePredicate(tuple: import('./selection-state').SelectionTuple, columns: SelectionColumns): string {
  if ('_vgsid_' in tuple) throw new Error('Identity selections cannot be translated to DuckDB rows');
  if (!tuple.fields.length) throw new Error('Selection tuple has no fields');
  return tuple.fields
    .map((raw, index) => {
      if (!isRecord(raw) || typeof raw.field !== 'string') throw new Error('Invalid selection field');
      const field = raw.field;
      if (!columns.names.has(field)) throw new Error(`Selection field is absent from the data handle: ${field}`);
      const column = sqlIdentifier(field);
      const value = tuple.values[index];
      if (raw.type === 'E') {
        const literal = literalFor(columns, field);
        if (Array.isArray(value)) {
          const members = value.map((member) => {
            const sql = literal(member);
            if (sql === null) throw new Error(`Selection member has no SQL literal: ${field}`);
            return sql;
          });
          return members.length ? `${column} IN (${members.join(', ')})` : 'FALSE';
        }
        return `${column} IS NOT DISTINCT FROM ${literal(value) ?? 'NULL'}`;
      }
      if (raw.type !== 'R' && raw.type !== 'R-RE')
        throw new Error(`Unsupported selection field type: ${String(raw.type)}`);
      if (!Array.isArray(value) || value.length !== 2) throw new Error('Expected selection range endpoints');
      const clock = columns.timestamps.get(field);
      const endpoints = value.map((endpoint) => (clock ? vegaInstant(endpoint) : endpoint));
      const [first, second] = endpoints;
      if (
        typeof first !== 'number' ||
        !Number.isFinite(first) ||
        typeof second !== 'number' ||
        !Number.isFinite(second)
      )
        throw new Error('Invalid selection range');
      const lo = Math.min(first, second),
        hi = Math.max(first, second);
      const lower = clock ? timestamp(lo, field, clock, Math.ceil) : sqlLiteral(lo);
      const upper = clock ? timestamp(hi, field, clock, raw.type === 'R-RE' ? Math.ceil : Math.floor) : sqlLiteral(hi);
      if (lower === null || upper === null) throw new Error('Invalid selection range');
      return `${column} >= ${lower} AND ${column} ${raw.type === 'R-RE' ? '<' : '<='} ${upper}`;
    })
    .map((term) => `(${term})`)
    .join(' AND ');
}

export function whereClauseForCurrentSelections(
  spec: VegaLiteSpecLike,
  view: VegaViewLike,
  columns: SelectionColumns,
  hoverFields: Readonly<Record<string, unknown>> | null = null,
): string | null {
  const hoverPreds = hoverPredicates(hoverFields, columns);

  if (hoverPreds.length) {
    return hoverPreds.map((p) => `(${p})`).join(' AND ');
  }

  const preds: string[] = [];
  for (const param of collectVegaLiteParams(spec)) {
    if (!param.select) continue;
    const select = normalizeSelect(param.select);
    if (!select) throw new Error('Invalid selection definition');
    const tuples = readSelectionTuples(view, param.name);
    if (tuples === undefined) throw new Error(`Selection store is unavailable: ${param.name}`);
    if (!tuples.length) continue;
    const units = new Map<string, string[]>();
    for (const tuple of tuples) {
      const unit = tuple.unit ?? '';
      const predicates = units.get(unit) ?? [];
      predicates.push(tuplePredicate(tuple, columns));
      units.set(unit, predicates);
    }
    const groups = [...units.values()].map((terms) => terms.map((term) => `(${term})`).join(' OR '));
    preds.push(groups.map((group) => `(${group})`).join(select.resolve === 'intersect' ? ' AND ' : ' OR '));
  }
  return preds.length ? preds.map((pred) => `(${pred})`).join(' AND ') : null;
}
