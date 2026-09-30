import { sqlIdentifier, sqlStringLiteral, sqlTimestampLiteral } from '@vacp/data-duckdb';
import type { VacpClock } from '@vacp/protocol';

import { collectVegaLiteParams, encodingField } from './params';
import { vegaInstant } from './temporal';
import type { VegaLiteSpecLike, VegaViewLike } from './types';

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
      return sqlStringLiteral(String(value));
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

function extractIntervalExtent(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const a = Number(value[0]);
  const b = Number(value[1]);

  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  return a <= b ? [a, b] : [b, a];
}

function intervalPredicatesFromSelection(
  spec: VegaLiteSpecLike,
  paramName: string,
  view: VegaViewLike,
  select: Record<string, unknown>,
  columns: SelectionColumns,
): string[] {
  const raw = view.signal(paramName);

  if (!isRecord(raw)) return [];

  const channels = Array.isArray(select.encodings) ? select.encodings : [];
  const fields = Array.isArray(select.fields) ? select.fields : [];
  const terms: Array<{ channel?: string; field?: string }> = [];

  channels.forEach((c) => {
    if (typeof c !== 'string') return;
    terms.push({ channel: c, field: encodingField(spec, c) ?? undefined });
  });
  fields.forEach((f) => {
    if (typeof f !== 'string') return;
    terms.push({ field: f });
  });

  // Vega-Lite shorthand selections (e.g. `"select": "interval"`) omit encodings/fields.
  // Default to an x/y interval, which matches pan/zoom ("bind": "scales") expectations.
  if (!terms.length) {
    terms.push({ channel: 'x' }, { channel: 'y' });
  }

  const preds: string[] = [];

  for (const t of terms) {
    const field = t.field ?? (t.channel ? (encodingField(spec, t.channel) ?? undefined) : undefined);

    if (!field) continue;

    let columnKey = field;
    let extent: [number, number] | null = null;

    // Most commonly, Vega-Lite interval signals are stored under the field name.
    extent = extractIntervalExtent(raw[field]);

    // Some specs (e.g. pan/zoom bind=scales) store extents under channel keys (`x`, `y`).
    // In that case, keep filtering by the field column but read extent from the channel key.
    if (!extent && t.channel) extent = extractIntervalExtent(raw[t.channel]);

    // Some transforms (e.g. timeUnit) use derived field keys in the signal object
    // (e.g. `monthdate_date`). If we don't find a match above, try `*_<field>`.
    if (!extent) {
      const suffix = `_${field}`;

      for (const k of Object.keys(raw)) {
        if (!k.endsWith(suffix)) continue;
        const e = extractIntervalExtent(raw[k]);

        if (!e) continue;
        columnKey = k;
        extent = e;
        break;
      }
    }

    if (!extent) continue;

    if (!columns.names.has(columnKey)) continue;
    const ident = sqlIdentifier(columnKey);
    const clock = columns.timestamps.get(columnKey);
    // Vega keeps an instant inside the brush when lo <= t <= hi, so the bounds round inward.
    const [lo, hi] = clock
      ? [timestamp(extent[0], columnKey, clock, Math.ceil), timestamp(extent[1], columnKey, clock, Math.floor)]
      : extent;
    preds.push(`(${ident} >= ${lo} AND ${ident} <= ${hi})`);
  }

  return preds;
}

function pointPredicatesFromSelection(
  spec: VegaLiteSpecLike,
  paramName: string,
  view: VegaViewLike,
  select: Record<string, unknown>,
  columns: SelectionColumns,
): string[] {
  const raw = view.signal(paramName);

  if (!isRecord(raw)) return [];

  const channels = Array.isArray(select.encodings) ? select.encodings : [];
  const fields = Array.isArray(select.fields) ? select.fields : [];
  const terms: Array<{ channel?: string; field?: string }> = [];

  channels.forEach((c) => {
    if (typeof c !== 'string') return;
    terms.push({ channel: c, field: encodingField(spec, c) ?? undefined });
  });
  fields.forEach((f) => {
    if (typeof f !== 'string') return;
    terms.push({ field: f });
  });

  const preds: string[] = [];

  for (const t of terms) {
    const field = t.field ?? (t.channel ? (encodingField(spec, t.channel) ?? undefined) : undefined);

    if (!field) continue;

    let columnKey = field;
    let v: unknown = raw[field];

    // Some specs store point selections under channel keys (`x`, `y`).
    if ((v === undefined || v === null) && t.channel) v = raw[t.channel];

    // Some transforms store selection values under derived field keys (e.g. `monthdate_date`).
    if (v === undefined || v === null) {
      const suffix = `_${field}`;

      for (const k of Object.keys(raw)) {
        if (!k.endsWith(suffix)) continue;
        const candidate = raw[k];

        if (candidate === undefined || candidate === null) continue;
        columnKey = k;
        v = candidate;
        break;
      }
    }

    if (v === undefined || v === null) continue;

    if (!columns.names.has(columnKey)) continue;
    const ident = sqlIdentifier(columnKey);
    const literal = literalFor(columns, columnKey);

    if (Array.isArray(v)) {
      const lits = v.map(literal).filter((x): x is string => x !== null);

      if (!lits.length) continue;
      preds.push(`(${ident} IN (${lits.join(', ')}))`);
      continue;
    }

    const lit = literal(v);

    if (!lit) continue;
    preds.push(`(${ident} = ${lit})`);
  }

  return preds;
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
  collectVegaLiteParams(spec).forEach((p) => {
    if (!p.select || typeof p.name !== 'string') return;
    const select = normalizeSelect(p.select);

    if (!select) return;
    const type = typeof select.type === 'string' ? select.type : '';

    if (type === 'interval') preds.push(...intervalPredicatesFromSelection(spec, p.name, view, select, columns));
    else preds.push(...pointPredicatesFromSelection(spec, p.name, view, select, columns));
  });

  if (!preds.length) return null;

  return preds.map((p) => `(${p})`).join(' AND ');
}
