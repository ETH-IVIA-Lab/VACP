import type { Dataset, DatasetRow } from '../datasets/registry';
import { toFiniteNumber } from './dashboard';

// Keep this palette visually distinct from the axis-specific colors used in the PDF charts
// (see --dim-x/--dim-y in index.css) to avoid cross-chart color confusion.
const palette = ['#F28E2B', '#E15759', '#59A14F', '#EDC948', '#76B7B2', '#9C755F', '#BAB0AC', '#8CD17D'] as const;

export function createDashboardColorAccessor(args: {
  dataset: Dataset;
  rows: DatasetRow[];
  colorKey: string | null;
}): (row: DatasetRow) => string {
  const { dataset, rows, colorKey } = args;

  if (!colorKey) return (_row) => palette[0];

  const colorColumn = dataset.columns.find((c) => c.key === colorKey) ?? null;
  const colorKind = colorColumn?.kind ?? 'unknown';

  if (colorKind === 'number') {
    const values = rows.map((r) => toFiniteNumber(r[colorKey])).filter((v): v is number => v !== null);

    if (!values.length) return (_row) => palette[0];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const denom = Math.max(1e-9, max - min);

    return (row: DatasetRow) => {
      const v = toFiniteNumber(row[colorKey]);

      if (v === null) return palette[0];
      const t = (v - min) / denom;
      const idx = Math.max(0, Math.min(palette.length - 1, Math.floor(t * palette.length)));

      return palette[idx] ?? palette[0];
    };
  }

  const unique = Array.from(new Set(rows.map((r) => String(r[colorKey])))).sort((a, b) => a.localeCompare(b));
  const map = new Map(unique.map((v, i) => [v, palette[i % palette.length]]));

  return (row: DatasetRow) => map.get(String(row[colorKey])) ?? palette[0];
}
