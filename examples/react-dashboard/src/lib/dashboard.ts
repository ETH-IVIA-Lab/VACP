import type { Dataset, Encoding } from '../datasets/registry';

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number') return null;

  if (!Number.isFinite(value)) return null;

  return value;
}

export function getNumericColumns(dataset: Dataset): string[] {
  return dataset.columns.filter((c) => c.kind === 'number' && c.key !== 'id').map((c) => c.key);
}

export function getColumns(dataset: Dataset): string[] {
  return dataset.columns.map((c) => c.key);
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const clamped = Math.max(0, Math.min(1, q));
  const idx = (sorted.length - 1) * clamped;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);

  if (lo === hi) return sorted[lo] ?? NaN;
  const loVal = sorted[lo] ?? NaN;
  const hiVal = sorted[hi] ?? NaN;
  const t = idx - lo;

  return loVal + (hiVal - loVal) * t;
}

export function numericValues(dataset: Dataset, key: string): number[] {
  return dataset.rows
    .map((row) => Number(row[key]))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
}

/** The same field choices offered by the dashboard controls. */
export function assertDashboardEncoding(dataset: Dataset | null, encoding: Encoding): void {
  if (!dataset) {
    if (encoding.x !== null || encoding.y !== null || encoding.color !== null) throw new Error('No dataset loaded');
    return;
  }
  const numeric = getNumericColumns(dataset);
  if ((encoding.x !== null && !numeric.includes(encoding.x)) || (encoding.y !== null && !numeric.includes(encoding.y)))
    throw new Error('Axes must name numeric columns in the current dataset');
  if (encoding.color !== null && !getColumns(dataset).includes(encoding.color))
    throw new Error('Color must name a column in the current dataset');
}

export function assertDashboardSelection(dataset: Dataset | null, ids: readonly string[]): void {
  if (!dataset) {
    if (ids.length) throw new Error('No dataset loaded');
    return;
  }
  const known = new Set(dataset.rows.map((row) => row.id));
  if (ids.some((id) => !known.has(id))) throw new Error('Selection must contain row IDs from the current dataset');
}
