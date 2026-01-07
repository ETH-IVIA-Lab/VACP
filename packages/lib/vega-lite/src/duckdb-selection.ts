import type { VegaLiteSpecLike, VegaViewLike } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlIdentifier(name: string): string {
  // Quote identifiers to handle reserved words (e.g. "group") and special chars.
  return `"${name.replaceAll('"', '""')}"`;
}

function sqlLiteral(value: unknown): string | null {
  if (value === null) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return sqlStringLiteral(value);
  return null;
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
    const field = t.field ?? (t.channel ? findEncodingField(spec, t.channel) ?? undefined : undefined);
    if (!field) continue;
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
    const field = t.field ?? (t.channel ? findEncodingField(spec, t.channel) ?? undefined : undefined);
    if (!field) continue;
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
  const preds: string[] = [];
  (spec.params ?? []).forEach((p) => {
    if (!p.select || typeof p.name !== 'string') return;
    const select = isRecord(p.select) ? p.select : null;
    if (!select) return;
    const type = typeof select.type === 'string' ? select.type : '';
    if (type === 'interval') preds.push(...intervalPredicatesFromSelection(spec, p.name, view, select));
    else preds.push(...pointPredicatesFromSelection(spec, p.name, view, select));
  });
  if (!preds.length) return null;
  return preds.map((p) => `(${p})`).join(' AND ');
}
