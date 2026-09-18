import type { VegaLiteSpecLike } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseDateMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (value instanceof Date) {
    const t = value.getTime();

    return Number.isFinite(t) ? t : null;
  }

  if (typeof value === 'string') {
    const s = value.trim();

    if (!s) return null;
    const n = Number(s);

    if (Number.isFinite(n)) return n;
    const t = Date.parse(s);

    return Number.isFinite(t) ? t : null;
  }

  return null;
}

function deriveMonthdateMs(ms: number): number | null {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);

  if (!Number.isFinite(d.getTime())) return null;
  const derived = new Date(2012, d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const t = derived.getTime();

  return Number.isFinite(t) ? t : null;
}

export function collectMonthdateDerivedFields(
  spec: VegaLiteSpecLike,
): Array<{ sourceField: string; derivedField: string }> {
  const out: Array<{ sourceField: string; derivedField: string }> = [];
  const seen = new Set<string>();

  const add = (field: string) => {
    const sourceField = field;
    const derivedField = `monthdate_${field}`;
    const key = `${sourceField}=>${derivedField}`;

    if (seen.has(key)) return;
    seen.add(key);
    out.push({ sourceField, derivedField });
  };

  const walk = (s: VegaLiteSpecLike) => {
    const enc = s.encoding;

    if (enc && isRecord(enc)) {
      for (const v of Object.values(enc)) {
        if (!isRecord(v)) continue;

        if (typeof v.field === 'string' && typeof v.timeUnit === 'string' && v.timeUnit === 'monthdate') add(v.field);
        const cond = v.condition;

        if (isRecord(cond)) {
          if (typeof cond.field === 'string' && cond.timeUnit === 'monthdate') add(cond.field);
        } else if (Array.isArray(cond)) {
          for (const c of cond) {
            if (!isRecord(c)) continue;

            if (typeof c.field === 'string' && c.timeUnit === 'monthdate') add(c.field);
          }
        }
      }
    }

    const children: unknown[] = [];

    if (Array.isArray(s.layer)) children.push(...s.layer);

    if (Array.isArray(s.hconcat)) children.push(...s.hconcat);

    if (Array.isArray(s.vconcat)) children.push(...s.vconcat);

    if (Array.isArray(s.concat)) children.push(...s.concat);

    if (s.spec) children.push(s.spec);

    for (const child of children) {
      if (!child || typeof child !== 'object') continue;
      walk(child);
    }
  };

  walk(spec);

  return out;
}

function sanitizeDuckDbValue(value: unknown) {
  if (value === undefined) return null;

  if (value === null) return null;

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;

  if (typeof value === 'bigint') return value.toString();

  if (value instanceof Date) {
    const t = value.getTime();

    return Number.isFinite(t) ? t : null;
  }

  if (Array.isArray(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  if (typeof value === 'object') {
    // DuckDB cannot infer types from an empty JSON object (`{}`) and errors
    // with "STRUCT with no fields". Treat those as null.
    if (Object.keys(value as Record<string, unknown>).length === 0) return null;

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

export function normalizeDataRows(
  dataRows: unknown[],
  derivations: Array<{ sourceField: string; derivedField: string }>,
): Record<string, unknown>[] {
  return dataRows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const result = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, sanitizeDuckDbValue(value)]));
    for (const { sourceField, derivedField } of derivations) {
      if (Object.hasOwn(result, derivedField) || !Object.hasOwn(row, sourceField)) continue;
      const value = parseDateMs(row[sourceField]);
      if (value !== null) result[derivedField] = deriveMonthdateMs(value);
    }
    return Object.keys(result).length > 0 ? [result] : [];
  });
}
