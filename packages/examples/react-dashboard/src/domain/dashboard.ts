import type { DatasetRow, Dataset } from '@/datasets/registry';
import type { BrushRange } from '@/state/dashboard-store';

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

export function sortRowsByNumericKey(rows: DatasetRow[], key: string): DatasetRow[] {
  const pairs = rows.map((row, i) => ({ row, i, v: toFiniteNumber(row[key]) })).filter((p) => p.v !== null) as Array<{
    row: DatasetRow;
    i: number;
    v: number;
  }>;
  pairs.sort((a, b) => (a.v === b.v ? a.i - b.i : a.v - b.v));
  return pairs.map((p) => p.row);
}

export function applyBrush(sortedRows: DatasetRow[], brush: BrushRange): DatasetRow[] {
  if (!brush) return sortedRows;
  const start = Math.max(0, Math.min(sortedRows.length, brush.startIndex));
  const end = Math.max(start, Math.min(sortedRows.length - 1, brush.endIndex));
  return sortedRows.slice(start, end + 1);
}

export function intersectIds(a: string[], b: string[]): string[] {
  if (a.length === 0 || b.length === 0) return [];
  const bSet = new Set(b);
  return a.filter((x) => bSet.has(x));
}

export type Point2D = { x: number; y: number };

export function pointInPolygon(p: Point2D, poly: Point2D[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x;
    const yi = poly[i]!.y;
    const xj = poly[j]!.x;
    const yj = poly[j]!.y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / Math.max(1e-9, yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
