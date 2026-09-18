import { useCallback, useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { DatasetRow } from '../../datasets/registry';
import { toFiniteNumber } from '../../lib/dashboard';

type PdfBin = {
  start: number;
  end: number;
  mid: number;
  density: number;
};

function computePdfBins(
  values: number[],
  numBins: number,
  domain?: { min: number; max: number } | null,
): { bins: PdfBin[]; maxDensity: number } {
  if (values.length === 0 || numBins <= 0) return { bins: [], maxDensity: 0 };

  const min = domain?.min ?? Math.min(...values);
  const max = domain?.max ?? Math.max(...values);
  const binWidth = (max - min) / numBins || 1;

  const counts = Array.from({ length: numBins }, () => 0);

  for (const v of values) {
    let idx = Math.floor((v - min) / binWidth);

    if (idx < 0) idx = 0;

    if (idx >= numBins) idx = numBins - 1;
    counts[idx] = (counts[idx] ?? 0) + 1;
  }

  const total = values.length;

  const bins: PdfBin[] = counts.map((count, i) => {
    const start = min + i * binWidth;
    const end = min + (i + 1) * binWidth;
    const density = count / total / binWidth;

    return { start, end, mid: (start + end) / 2, density };
  });

  const maxDensity = Math.max(...bins.map((b) => b.density), 0);

  return { bins, maxDensity: maxDensity || 0.001 };
}

function formatNumberShort(value: unknown, decimals = 2): string {
  const v = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(v)) return '';
  const pow = 10 ** Math.max(0, Math.min(6, Math.floor(decimals)));
  const rounded = Math.round(v * pow) / pow;

  if (Number.isInteger(rounded)) return String(rounded);

  return rounded.toFixed(decimals).replace(/\.?0+$/, '');
}

function getNumericValues(rows: DatasetRow[], key: string): number[] {
  const out: number[] = [];

  for (const row of rows) {
    const v = toFiniteNumber(row[key]);

    if (v === null) continue;
    out.push(v);
  }

  return out;
}

function getDomain(values: number[]): { min: number; max: number } | null {
  if (!values.length) return null;
  let min = values[0]!;
  let max = values[0]!;

  for (let i = 1; i < values.length; i++) {
    const v = values[i]!;

    if (v < min) min = v;

    if (v > max) max = v;
  }

  return { min, max };
}

export function PdfDistributionView({
  rows,
  selectedIds,
  xKey,
  yKey,
  numBins = 10,
  onClearSelection,
  onSetSelectedIds,
}: {
  rows: DatasetRow[];
  selectedIds: string[];
  xKey: string;
  yKey: string;
  numBins?: number;
  onClearSelection?: () => void;
  onSetSelectedIds: (ids: string[]) => void;
}) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const selectedRows = useMemo(
    () => (selectedIds.length ? rows.filter((r) => selectedSet.has(r.id)) : []),
    [rows, selectedIds.length, selectedSet],
  );

  const rowsForPdf = selectedRows.length ? selectedRows : rows;

  const xDomain = useMemo(() => getDomain(getNumericValues(rows, xKey)), [rows, xKey]);
  const yDomain = useMemo(() => getDomain(getNumericValues(rows, yKey)), [rows, yKey]);

  const x = useMemo(
    () => computePdfBins(getNumericValues(rowsForPdf, xKey), numBins, xDomain),
    [numBins, rowsForPdf, xDomain, xKey],
  );

  const y = useMemo(
    () => computePdfBins(getNumericValues(rowsForPdf, yKey), numBins, yDomain),
    [numBins, rowsForPdf, yDomain, yKey],
  );

  const toggleBinSelection = useCallback(
    (key: string, bin: PdfBin, isLastBin: boolean) => {
      const ids = rows
        .flatMap((row) => {
          const v = toFiniteNumber(row[key]);

          if (v === null) return [];

          if (v < bin.start) return [];

          if (isLastBin ? v > bin.end : v >= bin.end) return [];

          return [row.id];
        })
        .map(String);

      if (!ids.length) return;

      if (ids.length === selectedIds.length) {
        const next = new Set(ids);
        const same = selectedIds.every((id) => next.has(id));

        if (same) {
          onSetSelectedIds([]);

          return;
        }
      }

      onSetSelectedIds(ids);
    },
    [onSetSelectedIds, rows, selectedIds],
  );

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 gap-6">
      <div
        className="min-w-0 flex-1"
        onDoubleClickCapture={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClearSelection?.();
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={x.bins} margin={{ top: 12, right: 10, bottom: 34, left: 46 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="mid"
              interval="preserveStartEnd"
              tickFormatter={(v) => formatNumberShort(v, 1)}
              label={{ value: xKey, position: 'insideBottom', dy: 22 }}
            />
            <YAxis
              domain={[0, x.maxDensity]}
              tickFormatter={(v) => formatNumberShort(v, 2)}
              width={46}
              tickMargin={8}
            />
            <Tooltip
              formatter={(value) => [formatNumberShort(value, 4), 'density']}
              labelFormatter={(_label, payload) => {
                const p = Array.isArray(payload) ? (payload[0]?.payload as PdfBin | undefined) : undefined;

                if (!p) return '';

                return `${xKey}: ${formatNumberShort(p.start, 2)} -> ${formatNumberShort(p.end, 2)}`;
              }}
            />
            <Bar
              dataKey="density"
              fill="hsl(var(--dim-x))"
              isAnimationActive={false}
              onClick={(_data, index) => {
                const bin = x.bins[index];

                if (!bin) return;
                toggleBinSelection(xKey, bin, index === x.bins.length - 1);
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div
        className="min-w-0 flex-1"
        onDoubleClickCapture={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClearSelection?.();
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={y.bins} margin={{ top: 12, right: 10, bottom: 34, left: 46 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="mid"
              interval="preserveStartEnd"
              tickFormatter={(v) => formatNumberShort(v, 1)}
              label={{ value: yKey, position: 'insideBottom', dy: 22 }}
            />
            <YAxis
              domain={[0, y.maxDensity]}
              tickFormatter={(v) => formatNumberShort(v, 2)}
              width={46}
              tickMargin={8}
            />
            <Tooltip
              formatter={(value) => [formatNumberShort(value, 4), 'density']}
              labelFormatter={(_label, payload) => {
                const p = Array.isArray(payload) ? (payload[0]?.payload as PdfBin | undefined) : undefined;

                if (!p) return '';

                return `${yKey}: ${formatNumberShort(p.start, 2)} -> ${formatNumberShort(p.end, 2)}`;
              }}
            />
            <Bar
              dataKey="density"
              fill="hsl(var(--dim-y))"
              isAnimationActive={false}
              onClick={(_data, index) => {
                const bin = y.bins[index];

                if (!bin) return;
                toggleBinSelection(yKey, bin, index === y.bins.length - 1);
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
