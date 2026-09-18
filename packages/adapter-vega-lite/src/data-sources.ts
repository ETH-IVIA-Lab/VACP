import type { VegaLiteSpecLike, VegaViewLike } from './types.js';
import { collectVegaLiteParams } from './params.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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

export function collectSelectionFields(spec: VegaLiteSpecLike): string[] {
  const fields = new Set<string>();

  for (const p of collectVegaLiteParams(spec)) {
    if (!p.select || !isRecord(p.select)) continue;
    const select = p.select;

    const selectFields = Array.isArray(select.fields) ? select.fields : [];

    for (const f of selectFields) {
      if (typeof f === 'string' && f) fields.add(f);
    }

    const encodings = Array.isArray(select.encodings) ? select.encodings : [];

    for (const ch of encodings) {
      if (typeof ch !== 'string' || !ch) continue;
      const f = findEncodingField(spec, ch);

      if (f) fields.add(f);
    }
  }

  return Array.from(fields);
}

export type SpecDataSource = {
  key: string;
  id: string;
  title: string;
  values?: unknown[];
};

function sanitizeDataSourceId(value: string): string {
  const cleaned = value
    .replaceAll(/[/\\]+/g, '_')
    .replaceAll(/[^a-zA-Z0-9_-]+/g, '_')
    .replaceAll(/_+/g, '_')
    .replaceAll(/^_+|_+$/g, '');

  return cleaned || 'data';
}

function dataSourceFromDataObject(data: unknown, index: number): SpecDataSource | null {
  if (!data || typeof data !== 'object') return null;
  const rec = data as Record<string, unknown>;

  const url = typeof rec.url === 'string' ? rec.url : null;
  const values = Array.isArray(rec.values) ? rec.values : null;
  const format = rec.format;

  if (url) {
    const urlKey = url.trim();
    const fmt = isRecord(format) ? format : null;
    const fmtType = fmt && typeof fmt.type === 'string' ? fmt.type : '';
    const feature = fmt && typeof fmt.feature === 'string' ? fmt.feature : '';
    const key = `url:${urlKey}|format:${JSON.stringify(format ?? null)}`;

    const file = urlKey.split('?')[0]?.split('#')[0]?.split('/').filter(Boolean).pop() ?? urlKey;
    const stem = file.replaceAll(/\.[^.]+$/g, '') || file;
    const suffix = fmtType === 'topojson' && feature ? `_${feature}` : '';
    const id = `${sanitizeDataSourceId(`${stem}${suffix}`)}_${index}`;
    const title = `${file}${suffix ? ` (${feature})` : ''}`;

    return { key, id, title };
  }

  if (values) {
    const key = `values:${index}`;
    const id = `inline_${index}`;
    const title = `inline values (${values.length} rows)`;

    return { key, id, title, values };
  }

  return null;
}

export function collectSpecDataSources(spec: VegaLiteSpecLike): SpecDataSource[] {
  const out: SpecDataSource[] = [];
  const seen = new Set<string>();

  const add = (data: unknown) => {
    const ds = dataSourceFromDataObject(data, out.length);

    if (!ds) return;

    if (seen.has(ds.key)) return;
    seen.add(ds.key);
    out.push(ds);
  };

  const walk = (s: VegaLiteSpecLike) => {
    add(s.data);

    const transforms = Array.isArray(s.transform) ? s.transform : [];

    for (const t of transforms) {
      if (!t || typeof t !== 'object') continue;
      const rec = t as Record<string, unknown>;
      const from = rec.from;
      const fromRec = isRecord(from) ? from : null;

      if (fromRec && 'data' in fromRec) add(fromRec.data);
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

export function resolveDatasetNameByIndex(view: VegaViewLike, index: number): string | null {
  if (typeof view.data !== 'function') return null;
  // Prefer `source_*` for stable mapping from a spec's data sources to Vega datasets.
  // (`data_*` numbering can diverge due to per-layer/per-transform intermediate datasets.)
  const prefixes = ['source_', 'data_'];

  for (const prefix of prefixes) {
    const name = `${prefix}${index}`;

    try {
      const rows = view.data(name);

      if (Array.isArray(rows)) return name;
    } catch {
      // ignore
    }
  }

  return null;
}

export function selectRowsFromView(spec: VegaLiteSpecLike, view: VegaViewLike): unknown[] | null {
  // If the spec embeds values inline, prefer them (stable + small).
  const inlineValues = spec.data && typeof spec.data === 'object' && Array.isArray((spec.data as any).values);
  const inlineRows = inlineValues ? ((spec.data as any).values as unknown[]) : null;

  if (inlineRows) return inlineRows;

  const requiredFields = collectSelectionFields(spec);

  // Best-effort: discover datasets via Vega's getState() API. By default Vega
  // only exports modified datasets; we override the predicate to include any
  // dataset with an array-like input.
  const state =
    typeof view.getState === 'function'
      ? view.getState({
          data: (name: string, data: unknown) => {
            if (String(name).startsWith('_:vega:_')) return false;
            const input = (data as any)?.input?.value as unknown;

            return Array.isArray(input);
          },
          signals: () => false,
          recurse: true,
        })
      : null;

  const stateData = isRecord(state) ? state.data : null;
  const dataMap = isRecord(stateData) ? stateData : null;

  const candidates: Array<{ name: string; rows: unknown[] }> = [];

  if (dataMap) {
    for (const [name, v] of Object.entries(dataMap)) {
      if (Array.isArray(v)) {
        candidates.push({ name, rows: v });
        continue;
      }

      if (isRecord(v) && Array.isArray(v.values)) {
        candidates.push({ name, rows: v.values as unknown[] });
      }
    }
  }

  // Fallback: probe common Vega-Lite dataset names when getState isn't available.
  if (!candidates.length && typeof view.data === 'function') {
    const prefixes = ['source_', 'data_'];

    for (const prefix of prefixes) {
      for (let i = 0; i < 25; i += 1) {
        const name = `${prefix}${i}`;

        try {
          const rows = view.data(name);

          if (Array.isArray(rows)) candidates.push({ name, rows });
        } catch {
          // ignore
        }
      }
    }
  }

  const scoreCandidate = (candidate: { name: string; rows: unknown[] }): number =>
    scoreDataRows(candidate.rows, requiredFields) - (candidate.name.includes('_store') ? 2_000 : 0);

  const scored = candidates
    .flatMap((c) => {
      const score = scoreCandidate(c);
      return score >= 0 && c.rows.length > 0 ? [{ ...c, score }] : [];
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.rows ?? null;
}

export function scoreDataRows(rows: unknown[] | null, requiredFields: string[]): number {
  if (!rows || !rows.length) return -1;
  const sample = rows.find(isRecord);

  if (!sample) return -1;
  let fieldMatches = 0;

  for (const f of requiredFields) if (f && Object.prototype.hasOwnProperty.call(sample, f)) fieldMatches += 1;
  let primitiveFields = 0;
  let nestedFields = 0;

  for (const v of Object.values(sample)) {
    if (v === null || v === undefined) continue;

    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') primitiveFields += 1;
    else nestedFields += 1;
  }

  const looksGeoJson = sample.type === 'Feature' && isRecord(sample.geometry);
  const hasGeometry = Object.prototype.hasOwnProperty.call(sample, 'geometry');
  const sizeScore = Math.log10(Math.max(1, rows.length));
  let score = 0;
  score += fieldMatches * 1000;
  score += primitiveFields * 10;
  score -= nestedFields * 50;
  score += sizeScore;

  if (looksGeoJson || hasGeometry) score -= 250;

  return score;
}
