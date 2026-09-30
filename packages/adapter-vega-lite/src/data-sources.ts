import type { VegaLiteSpecLike } from './types';
import type { VegaLiteSource } from './dataflow';
import { collectVegaLiteParams, encodingField } from './params';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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
      const f = encodingField(spec, ch);

      if (f) fields.add(f);
    }
  }

  return Array.from(fields);
}

function sanitizeDataSourceId(value: string): string {
  const cleaned = value
    .replaceAll(/[/\\]+/g, '_')
    .replaceAll(/[^a-zA-Z0-9_-]+/g, '_')
    .replaceAll(/_+/g, '_')
    .replaceAll(/^_+|_+$/g, '');

  return cleaned || 'data';
}

/** A stable id and a title for one of the chart's sources: its url, its inline values, or its dataset name. */
export function describeSource(source: VegaLiteSource, index: number): { id: string; title: string } {
  const { url, values, format } = source.data;

  if (url) {
    const urlKey = url.trim();
    const fmt = isRecord(format) ? format : null;
    const fmtType = fmt && typeof fmt.type === 'string' ? fmt.type : '';
    const feature = fmt && typeof fmt.feature === 'string' ? fmt.feature : '';
    const file = urlKey.split('?')[0]?.split('#')[0]?.split('/').filter(Boolean).pop() ?? urlKey;
    const stem = file.replaceAll(/\.[^.]+$/g, '') || file;
    const suffix = fmtType === 'topojson' && feature ? `_${feature}` : '';
    return {
      id: `${sanitizeDataSourceId(`${stem}${suffix}`)}_${index}`,
      title: `${file}${suffix ? ` (${feature})` : ''}`,
    };
  }

  if (values) return { id: `inline_${index}`, title: `inline values (${values.length} rows)` };

  return { id: `${sanitizeDataSourceId(source.dataset)}_${index}`, title: `${source.dataset} dataset` };
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
