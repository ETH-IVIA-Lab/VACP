import { sqlIdentifier, sqlStringLiteral } from '@vacp/data-duckdb';
import type { VegaLiteSpecLike, VegaViewLike } from './types.js';
import { collectVegaLiteParams } from './params.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSelect(select: unknown): Record<string, unknown> | null {
  if (typeof select === 'string') return { type: select };

  if (isRecord(select)) return select;

  return null;
}

function sqlLiteral(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number' && Number.isFinite(value)) return String(value);

  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (typeof value === 'string') return sqlStringLiteral(value);

  if (typeof value === 'bigint') return sqlStringLiteral(value.toString());

  if (value instanceof Date) {
    const t = value.getTime();

    if (!Number.isFinite(t)) return null;

    return String(t);
  }

  if (Array.isArray(value) || isRecord(value)) {
    try {
      return sqlStringLiteral(JSON.stringify(value));
    } catch {
      return sqlStringLiteral(String(value));
    }
  }

  return null;
}

function hoverPredicates(
  fields: Readonly<Record<string, unknown>> | null,
  allowed: ReadonlySet<string> | null,
): string[] {
  if (!isRecord(fields)) return [];

  const preds: string[] = [];

  for (const [field, value] of Object.entries(fields)) {
    if (!field) continue;

    if (allowed && !allowed.has(field)) continue;
    const ident = sqlIdentifier(field);

    if (Array.isArray(value)) {
      const lits = value.map(sqlLiteral).filter((x): x is string => x !== null);

      if (!lits.length) continue;
      preds.push(`(${ident} IN (${lits.join(', ')}))`);
      continue;
    }

    const lit = sqlLiteral(value);

    if (!lit) continue;
    preds.push(`(${ident} = ${lit})`);
  }

  return preds;
}

function findEncodingField(spec: VegaLiteSpecLike, channel: string): string | null {
  const enc = spec.encoding;
  const field = enc && isRecord(enc) ? (enc[channel] as unknown) : null;

  if (field && isRecord(field)) {
    if (typeof field.field === 'string') return field.field;
    const cond = field.condition;

    if (isRecord(cond) && typeof cond.field === 'string') return cond.field;

    if (Array.isArray(cond)) {
      for (const c of cond) {
        if (isRecord(c) && typeof c.field === 'string') return c.field;
      }
    }
  }

  const children: unknown[] = [];

  if (Array.isArray(spec.layer)) children.push(...spec.layer);

  if (Array.isArray(spec.hconcat)) children.push(...spec.hconcat);

  if (Array.isArray(spec.vconcat)) children.push(...spec.vconcat);

  if (Array.isArray(spec.concat)) children.push(...spec.concat);

  if (spec.spec) children.push(spec.spec);

  for (const child of children) {
    if (!child || typeof child !== 'object') continue;
    const f = findEncodingField(child, channel);

    if (f) return f;
  }

  return null;
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
  allowed: ReadonlySet<string> | null,
): string[] {
  const raw = view.signal(paramName);

  if (!isRecord(raw)) return [];

  const channels = Array.isArray(select.encodings) ? select.encodings : [];
  const fields = Array.isArray(select.fields) ? select.fields : [];
  const terms: Array<{ channel?: string; field?: string }> = [];

  channels.forEach((c) => {
    if (typeof c !== 'string') return;
    terms.push({ channel: c, field: findEncodingField(spec, c) ?? undefined });
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
    const field = t.field ?? (t.channel ? (findEncodingField(spec, t.channel) ?? undefined) : undefined);

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

    if (allowed && !allowed.has(columnKey)) continue;
    const ident = sqlIdentifier(columnKey);
    preds.push(`(${ident} >= ${extent[0]} AND ${ident} <= ${extent[1]})`);
  }

  return preds;
}

function pointPredicatesFromSelection(
  spec: VegaLiteSpecLike,
  paramName: string,
  view: VegaViewLike,
  select: Record<string, unknown>,
  allowed: ReadonlySet<string> | null,
): string[] {
  const raw = view.signal(paramName);

  if (!isRecord(raw)) return [];

  const channels = Array.isArray(select.encodings) ? select.encodings : [];
  const fields = Array.isArray(select.fields) ? select.fields : [];
  const terms: Array<{ channel?: string; field?: string }> = [];

  channels.forEach((c) => {
    if (typeof c !== 'string') return;
    terms.push({ channel: c, field: findEncodingField(spec, c) ?? undefined });
  });
  fields.forEach((f) => {
    if (typeof f !== 'string') return;
    terms.push({ field: f });
  });

  const preds: string[] = [];

  for (const t of terms) {
    const field = t.field ?? (t.channel ? (findEncodingField(spec, t.channel) ?? undefined) : undefined);

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

    if (allowed && !allowed.has(columnKey)) continue;
    const ident = sqlIdentifier(columnKey);

    if (Array.isArray(v)) {
      const lits = v.map(sqlLiteral).filter((x): x is string => x !== null);

      if (!lits.length) continue;
      preds.push(`(${ident} IN (${lits.join(', ')}))`);
      continue;
    }

    const lit = sqlLiteral(v);

    if (!lit) continue;
    preds.push(`(${ident} = ${lit})`);
  }

  return preds;
}

export function whereClauseForCurrentSelections(
  spec: VegaLiteSpecLike,
  view: VegaViewLike,
  allowed: ReadonlySet<string> | null = null,
  hoverFields: Readonly<Record<string, unknown>> | null = null,
): string | null {
  const hoverPreds = hoverPredicates(hoverFields, allowed);

  if (hoverPreds.length) {
    return hoverPreds.map((p) => `(${p})`).join(' AND ');
  }

  const preds: string[] = [];
  collectVegaLiteParams(spec).forEach((p) => {
    if (!p.select || typeof p.name !== 'string') return;
    const select = normalizeSelect(p.select);

    if (!select) return;
    const type = typeof select.type === 'string' ? select.type : '';

    if (type === 'interval') preds.push(...intervalPredicatesFromSelection(spec, p.name, view, select, allowed));
    else preds.push(...pointPredicatesFromSelection(spec, p.name, view, select, allowed));
  });

  if (!preds.length) return null;

  return preds.map((p) => `(${p})`).join(' AND ');
}
