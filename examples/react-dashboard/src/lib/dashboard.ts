import type { Dataset } from '../datasets/registry';

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
