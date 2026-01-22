import { sqlIdentifier, sqlStringLiteral } from '@vacp/duckdb';
import type { VegaLiteSpecLike, VegaViewLike } from './types';
import { collectVegaLiteParams } from './params';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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
    return sqlStringLiteral(value.toISOString());
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

function allowedFieldsFromView(view: VegaViewLike): Set<string> | null {
  const rec = view as unknown as { __vacpVegaLiteDuckDbFields?: unknown };
  const raw = rec.__vacpVegaLiteDuckDbFields;
  if (!Array.isArray(raw)) return null;
  const fields = raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return fields.length ? new Set(fields) : null;
}

function hoverPredicatesFromView(view: VegaViewLike, allowed: Set<string> | null): string[] {
  const rec = view as unknown as { __vacpVegaLiteTooltipHover?: unknown };
  const hover = rec.__vacpVegaLiteTooltipHover;
  if (!hover || !isRecord(hover)) return [];
  const fields = hover.fields;
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
  if (field && isRecord(field) && typeof field.field === 'string') return field.field;

  const children: unknown[] = [];
  if (Array.isArray(spec.layer)) children.push(...spec.layer);
  if (Array.isArray(spec.hconcat)) children.push(...spec.hconcat);
  if (Array.isArray(spec.vconcat)) children.push(...spec.vconcat);
  if (Array.isArray(spec.concat)) children.push(...spec.concat);
  if (spec.spec) children.push(spec.spec);

  for (const child of children) {
    if (!child || typeof child !== 'object') continue;
    const f = findEncodingField(child as VegaLiteSpecLike, channel);
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
  allowed: Set<string> | null,
): string[] {
  const raw = view.signal(paramName);
  if (!isRecord(raw)) return [];

  const channels = Array.isArray(select.encodings) ? (select.encodings as unknown[]) : [];
  const fields = Array.isArray(select.fields) ? (select.fields as unknown[]) : [];
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
    if (allowed && !allowed.has(field)) continue;
    const ident = sqlIdentifier(field);

    const byField = raw[field];
    const byChannel = t.channel ? raw[t.channel] : undefined;
    const extent = extractIntervalExtent(byField) ?? extractIntervalExtent(byChannel);
    if (!extent) continue;
    preds.push(`(${ident} >= ${extent[0]} AND ${ident} <= ${extent[1]})`);
  }

  return preds;
}

function pointPredicatesFromSelection(
  spec: VegaLiteSpecLike,
  paramName: string,
  view: VegaViewLike,
  select: Record<string, unknown>,
  allowed: Set<string> | null,
): string[] {
  const raw = view.signal(paramName);
  if (!isRecord(raw)) return [];

  const channels = Array.isArray(select.encodings) ? (select.encodings as unknown[]) : [];
  const fields = Array.isArray(select.fields) ? (select.fields as unknown[]) : [];
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
    if (allowed && !allowed.has(field)) continue;
    const ident = sqlIdentifier(field);

    const v = raw[field] ?? (t.channel ? raw[t.channel] : undefined);
    if (v === undefined || v === null) continue;
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

export function whereClauseForCurrentSelections(spec: VegaLiteSpecLike, view: VegaViewLike): string | null {
  const allowed = allowedFieldsFromView(view);

  const hoverPreds = hoverPredicatesFromView(view, allowed);
  if (hoverPreds.length) {
    return hoverPreds.map((p) => `(${p})`).join(' AND ');
  }

  const preds: string[] = [];
  collectVegaLiteParams(spec).forEach((p) => {
    if (!p.select || typeof p.name !== 'string') return;
    const select = isRecord(p.select) ? p.select : null;
    if (!select) return;
    const type = typeof select.type === 'string' ? select.type : '';
    if (type === 'interval') preds.push(...intervalPredicatesFromSelection(spec, p.name, view, select, allowed));
    else preds.push(...pointPredicatesFromSelection(spec, p.name, view, select, allowed));
  });
  if (!preds.length) return null;
  return preds.map((p) => `(${p})`).join(' AND ');
}
