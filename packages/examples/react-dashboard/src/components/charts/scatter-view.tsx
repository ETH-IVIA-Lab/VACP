import { useMemo, useRef, useState } from 'react';
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';

import type { Dataset, DatasetRow, Encoding } from '@/datasets/registry';
import { pointInPolygon, toFiniteNumber } from '@/lib/dashboard';

type Props = {
  dataset: Dataset;
  rows: DatasetRow[];
  encoding: Encoding;
  selectedIds: string[];
  onToggleSelectedId: (id: string) => void;
  onApplyLassoSelection: (args: { polygon: Array<{ x: number; y: number }>; ids: string[] }) => void;
  onResetSelection: () => void;
};

const palette = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

function labelForChannel(key: string): string {
  return key === 'id' ? 'id' : key;
}

type Point = { x: number; y: number };

function fitLinear(pairs: Array<{ d: number; p: number }>): { a: number; b: number } | null {
  if (pairs.length < 2) return null;
  const meanD = pairs.reduce((acc, x) => acc + x.d, 0) / pairs.length;
  const meanP = pairs.reduce((acc, x) => acc + x.p, 0) / pairs.length;
  let varD = 0;
  let cov = 0;
  for (const x of pairs) {
    const dd = x.d - meanD;
    const pp = x.p - meanP;
    varD += dd * dd;
    cov += dd * pp;
  }
  if (!Number.isFinite(varD) || Math.abs(varD) < 1e-9) return null;
  const a = cov / varD;
  if (!Number.isFinite(a) || Math.abs(a) < 1e-9) return null;
  const b = meanP - a * meanD;
  if (!Number.isFinite(b)) return null;
  return { a, b };
}

function roundPoint(p: Point): Point {
  return { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 };
}

export function ScatterView({
  dataset,
  rows,
  encoding,
  selectedIds,
  onToggleSelectedId,
  onApplyLassoSelection,
  onResetSelection,
}: Props) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const lastSelectedId = useMemo(
    () => (selectedIds.length ? selectedIds[selectedIds.length - 1] : null),
    [selectedIds],
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lassoPointsRef = useRef<Point[]>([]);
  const [lasso, setLasso] = useState<{ active: boolean; points: Point[] }>({ active: false, points: [] });

  const colorKey = encoding.color;
  const colorColumn = colorKey ? dataset.columns.find((c) => c.key === colorKey) : null;
  const colorMode = colorColumn?.kind ?? (colorKey ? 'unknown' : null);

  const colorAccessor = useMemo(() => {
    if (!colorKey) return (_row: DatasetRow) => palette[0];
    if (!colorColumn) return (_row: DatasetRow) => palette[0];

    if (colorMode === 'number') {
      const values = rows.map((r) => toFiniteNumber(r[colorKey])).filter((v): v is number => v !== null);
      if (!values.length) return (_row: DatasetRow) => palette[0];
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
  }, [colorColumn, colorKey, colorMode, rows]);

  const data = useMemo(() => {
    const xKey = encoding.x;
    const yKey = encoding.y;
    return rows
      .map((row) => {
        const x = toFiniteNumber(row[xKey]);
        const y = toFiniteNumber(row[yKey]);
        if (x === null || y === null) return null;
        return { id: row.id, x, y, row, fill: colorAccessor(row) };
      })
      .filter(Boolean) as Array<{ id: string; x: number; y: number; row: DatasetRow; fill: string }>;
  }, [colorAccessor, encoding.x, encoding.y, rows]);

  const selectedData = useMemo(() => data.filter((d) => selectedSet.has(d.id)), [data, selectedSet]);
  const unselectedData = useMemo(() => data.filter((d) => !selectedSet.has(d.id)), [data, selectedSet]);
  const topSelected = useMemo(
    () => (lastSelectedId ? selectedData.filter((d) => d.id === lastSelectedId) : []),
    [lastSelectedId, selectedData],
  );
  const restSelected = useMemo(
    () => (lastSelectedId ? selectedData.filter((d) => d.id !== lastSelectedId) : selectedData),
    [lastSelectedId, selectedData],
  );

  return (
    <div
      ref={containerRef}
      className="relative"
      onDoubleClickCapture={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onResetSelection();
      }}
      onPointerDownCapture={(e) => {
        if (!e.shiftKey) return;
        const root = containerRef.current;
        if (!root) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = root.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        root.setPointerCapture(e.pointerId);
        lassoPointsRef.current = [{ x, y }];
        setLasso({ active: true, points: lassoPointsRef.current });
      }}
      onPointerMoveCapture={(e) => {
        if (!lasso.active) return;
        const root = containerRef.current;
        if (!root) return;
        const rect = root.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const prev = lassoPointsRef.current.at(-1);
        if (prev && Math.hypot(prev.x - x, prev.y - y) < 2) return;
        lassoPointsRef.current = [...lassoPointsRef.current, { x, y }];
        setLasso({ active: true, points: lassoPointsRef.current });
      }}
      onPointerUpCapture={(e) => {
        if (!lasso.active) return;
        const root = containerRef.current;
        if (!root) return;
        try {
          root.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }

        const polyPx = lassoPointsRef.current;
        lassoPointsRef.current = [];
        setLasso({ active: false, points: [] });
        if (polyPx.length < 3) return;

        const overlayRect = root.getBoundingClientRect();
        const circles = Array.from(root.querySelectorAll('circle[data-point-id][data-x][data-y]'));
        const xPairs: Array<{ d: number; p: number }> = [];
        const yPairs: Array<{ d: number; p: number }> = [];
        circles.forEach((c) => {
          const dx = Number(c.getAttribute('data-x'));
          const dy = Number(c.getAttribute('data-y'));
          if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
          const r = c.getBoundingClientRect();
          const px = r.left + r.width / 2 - overlayRect.left;
          const py = r.top + r.height / 2 - overlayRect.top;
          if (!Number.isFinite(px) || !Number.isFinite(py)) return;
          xPairs.push({ d: dx, p: px });
          yPairs.push({ d: dy, p: py });
        });
        const xFit = fitLinear(xPairs);
        const yFit = fitLinear(yPairs);
        if (!xFit || !yFit) return;

        const polyData = polyPx
          .map((p) => ({ x: (p.x - xFit.b) / xFit.a, y: (p.y - yFit.b) / yFit.a }))
          .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
          .map(roundPoint);
        if (polyData.length < 3) return;

        const ids = data.filter((d) => pointInPolygon({ x: d.x, y: d.y }, polyData)).map((d) => d.id);
        onApplyLassoSelection({ polygon: polyData, ids });
      }}
    >
      <ResponsiveContainer width="100%" height={460}>
        <ScatterChart margin={{ top: 12, right: 16, bottom: 36, left: 44 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="x"
            type="number"
            name={labelForChannel(encoding.x)}
            label={{ value: encoding.x, position: 'insideBottom', dy: 18 }}
          />
          <YAxis
            dataKey="y"
            type="number"
            name={labelForChannel(encoding.y)}
            label={{ value: encoding.y, angle: -90, position: 'insideLeft', dx: -28 }}
          />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            formatter={(value, name) => {
              if (name === 'x') return [value, encoding.x];
              if (name === 'y') return [value, encoding.y];
              if (name === 'fill') return [value, encoding.color ?? 'color'];
              return [value, name];
            }}
            labelFormatter={(_, payload) => {
              const p = Array.isArray(payload) ? payload[0]?.payload : undefined;
              return p?.id ? `id: ${String(p.id)}` : '';
            }}
          />
          <Scatter
            data={unselectedData}
            isAnimationActive={false}
            animationDuration={0}
            shape={(p: any) => {
              const id = String(p?.payload?.id ?? '');
              const x = typeof p?.payload?.x === 'number' ? p.payload.x : null;
              const y = typeof p?.payload?.y === 'number' ? p.payload.y : null;
              return (
                <circle
                  cx={p.cx}
                  cy={p.cy}
                  r={4}
                  fill={p.fill}
                  stroke="transparent"
                  strokeWidth={0}
                  data-point-id={id}
                  data-x={x ?? undefined}
                  data-y={y ?? undefined}
                  data-selected="false"
                  className="cursor-pointer"
                  onClick={() => id && onToggleSelectedId(id)}
                />
              );
            }}
          />
          <Scatter
            data={restSelected}
            isAnimationActive={false}
            animationDuration={0}
            shape={(p: any) => {
              const id = String(p?.payload?.id ?? '');
              const x = typeof p?.payload?.x === 'number' ? p.payload.x : null;
              const y = typeof p?.payload?.y === 'number' ? p.payload.y : null;
              return (
                <circle
                  cx={p.cx}
                  cy={p.cy}
                  r={6}
                  fill={p.fill}
                  stroke="hsl(var(--foreground))"
                  strokeWidth={1.75}
                  data-point-id={id}
                  data-x={x ?? undefined}
                  data-y={y ?? undefined}
                  data-selected="true"
                  className="cursor-pointer"
                  onClick={() => id && onToggleSelectedId(id)}
                />
              );
            }}
          />
          <Scatter
            data={topSelected}
            isAnimationActive={false}
            animationDuration={0}
            shape={(p: any) => {
              const id = String(p?.payload?.id ?? '');
              const x = typeof p?.payload?.x === 'number' ? p.payload.x : null;
              const y = typeof p?.payload?.y === 'number' ? p.payload.y : null;
              return (
                <circle
                  cx={p.cx}
                  cy={p.cy}
                  r={7}
                  fill={p.fill}
                  stroke="hsl(var(--foreground))"
                  strokeWidth={2}
                  data-point-id={id}
                  data-x={x ?? undefined}
                  data-y={y ?? undefined}
                  data-selected="true"
                  className="cursor-pointer"
                  onClick={() => id && onToggleSelectedId(id)}
                />
              );
            }}
          />
        </ScatterChart>
      </ResponsiveContainer>

      <svg
        className="pointer-events-none absolute bottom-0 left-0 right-0 top-0 h-full w-full"
        width="100%"
        height="100%"
        preserveAspectRatio="none"
      >
        {lasso.points.length ? (
          <path
            d={`M ${lasso.points.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`}
            fill="hsl(var(--foreground) / 0.08)"
            stroke="hsl(var(--foreground) / 0.6)"
            strokeWidth={1.5}
          />
        ) : null}
      </svg>
    </div>
  );
}
