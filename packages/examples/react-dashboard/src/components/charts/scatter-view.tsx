import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';

import type { Dataset, DatasetRow } from '@/datasets/registry';
import { toFiniteNumber } from '@/lib/dashboard';
import { createDashboardColorAccessor } from '@/lib/color-encoding';

type ScatterEncoding = { x: string; y: string; color: string | null };

type Props = {
  dataset: Dataset;
  rows: DatasetRow[];
  encoding: ScatterEncoding;
  selectedIds: string[];
  brush2d: { x0: number; x1: number; y0: number; y1: number } | null;
  onToggleSelectedId: (id: string) => void;
  onSetBrush2d: (brush: { x0: number; x1: number; y0: number; y1: number }) => void;
  onClearSelection: () => void;
};

function labelForChannel(key: string): string {
  return key === 'id' ? 'id' : key;
}

type ScatterShapeProps = {
  cx?: unknown;
  cy?: unknown;
  fill?: unknown;
  payload?: unknown;
};

type ScatterPayload = Partial<{
  id: unknown;
  x: unknown;
  y: unknown;
  clickThrough: unknown;
}>;

type Point2D = { x: number; y: number };

type Fit = { a: number; b: number };
type Fits = { rect: DOMRect; x: Fit; y: Fit };

type DragState =
  | { mode: 'idle' }
  | {
      mode: 'pending-new' | 'pending-move' | 'drag-new' | 'drag-move';
      pointerId: number;
      startClient: { x: number; y: number };
      startData: Point2D;
      baseBrush: { x0: number; x1: number; y0: number; y1: number } | null;
      fits: Fits;
    };

function fitLinear(pairs: Array<{ d: number; p: number }>): Fit | null {
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
  if (!Number.isFinite(a) || Math.abs(a) < 1e-12) return null;
  const b = meanP - a * meanD;
  if (!Number.isFinite(b)) return null;
  return { a, b };
}

function computeFits(root: HTMLElement): Fits | null {
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
  if (!xFit || !yFit) return null;
  return { rect: overlayRect, x: xFit, y: yFit };
}

function clientToData(client: { x: number; y: number }, fits: Fits): Point2D {
  const px = client.x - fits.rect.left;
  const py = client.y - fits.rect.top;
  return { x: (px - fits.x.b) / fits.x.a, y: (py - fits.y.b) / fits.y.a };
}

function brushToRectPx(brush: { x0: number; x1: number; y0: number; y1: number }, fits: Fits) {
  const x0 = fits.x.a * brush.x0 + fits.x.b;
  const x1 = fits.x.a * brush.x1 + fits.x.b;
  const y0 = fits.y.a * brush.y0 + fits.y.b;
  const y1 = fits.y.a * brush.y1 + fits.y.b;
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const width = Math.abs(x1 - x0);
  const height = Math.abs(y1 - y0);
  return { left, top, width, height };
}

export function ScatterView({
  dataset,
  rows,
  encoding,
  selectedIds,
  brush2d,
  onToggleSelectedId,
  onSetBrush2d,
  onClearSelection,
}: Props) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const lastSelectedId = useMemo(
    () => (selectedIds.length ? selectedIds[selectedIds.length - 1] : null),
    [selectedIds],
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);
  const dragRef = useRef<DragState>({ mode: 'idle' });
  const [previewBrush, setPreviewBrush] = useState<{ x0: number; x1: number; y0: number; y1: number } | null>(null);
  const [fitsState, setFitsState] = useState<Fits | null>(null);

  const colorAccessor = useMemo(
    () => createDashboardColorAccessor({ dataset, rows, colorKey: encoding.color }),
    [dataset, encoding.color, rows],
  );

  const data = useMemo(() => {
    const xKey = encoding.x;
    const yKey = encoding.y;
    const seen = new Set<string>();
    return rows
      .map((row) => {
        const x = toFiniteNumber(row[xKey]);
        const y = toFiniteNumber(row[yKey]);
        if (x === null || y === null) return null;
        const key = `${x}|${y}`;
        const clickThrough = seen.has(key);
        seen.add(key);
        return { id: row.id, x, y, row, fill: colorAccessor(row), clickThrough };
      })
      .filter(Boolean) as Array<{
      id: string;
      x: number;
      y: number;
      row: DatasetRow;
      fill: string;
      clickThrough: boolean;
    }>;
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

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const raf = window.requestAnimationFrame(() => setFitsState(computeFits(root)));
    return () => window.cancelAnimationFrame(raf);
  }, [data.length, encoding.x, encoding.y]);

  const activeBrush = previewBrush ?? brush2d;

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-0 w-full"
      onDoubleClickCapture={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClearSelection();
      }}
      onPointerDownCapture={(e) => {
        const root = containerRef.current;
        if (!root) return;
        const fits = computeFits(root);
        if (!fits) return;

        const startClient = { x: e.clientX, y: e.clientY };
        const startData = clientToData(startClient, fits);

        const active = brush2d;
        const px = e.clientX - fits.rect.left;
        const py = e.clientY - fits.rect.top;
        const hit =
          active &&
          (() => {
            const r = brushToRectPx(active, fits);
            return px >= r.left && px <= r.left + r.width && py >= r.top && py <= r.top + r.height;
          })();

        dragRef.current = {
          mode: hit ? 'pending-move' : 'pending-new',
          pointerId: e.pointerId,
          startClient,
          startData,
          baseBrush: hit ? active : null,
          fits,
        };
      }}
      onPointerMoveCapture={(e) => {
        const s = dragRef.current;
        if (s.mode === 'idle') return;
        if (e.pointerId !== s.pointerId) return;

        const dx = e.clientX - s.startClient.x;
        const dy = e.clientY - s.startClient.y;
        const dist = Math.hypot(dx, dy);
        const threshold = 4;

        if (s.mode === 'pending-new' || s.mode === 'pending-move') {
          if (dist < threshold) return;
          suppressClickRef.current = true;
          try {
            containerRef.current?.setPointerCapture(s.pointerId);
          } catch {
            // ignore
          }
          dragRef.current = { ...s, mode: s.mode === 'pending-move' ? 'drag-move' : 'drag-new' };
        }

        const next = dragRef.current;
        if (next.mode !== 'drag-new' && next.mode !== 'drag-move') return;

        const curData = clientToData({ x: e.clientX, y: e.clientY }, next.fits);
        const brush =
          next.mode === 'drag-move' && next.baseBrush
            ? (() => {
                const ddx = curData.x - next.startData.x;
                const ddy = curData.y - next.startData.y;
                return {
                  x0: next.baseBrush.x0 + ddx,
                  x1: next.baseBrush.x1 + ddx,
                  y0: next.baseBrush.y0 + ddy,
                  y1: next.baseBrush.y1 + ddy,
                };
              })()
            : { x0: next.startData.x, x1: curData.x, y0: next.startData.y, y1: curData.y };

        setPreviewBrush(brush);
        onSetBrush2d(brush);
      }}
      onPointerUpCapture={(e) => {
        const s = dragRef.current;
        if (s.mode === 'idle') return;
        if (e.pointerId !== s.pointerId) return;
        dragRef.current = { mode: 'idle' };
        setPreviewBrush(null);
        try {
          containerRef.current?.releasePointerCapture(s.pointerId);
        } catch {
          // ignore
        }
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
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
            shape={(props: ScatterShapeProps) => {
              const payload =
                typeof props.payload === 'object' && props.payload !== null ? (props.payload as ScatterPayload) : {};
              const id = String(payload.id ?? '');
              const x = typeof payload.x === 'number' ? payload.x : null;
              const y = typeof payload.y === 'number' ? payload.y : null;
              const cx = typeof props.cx === 'number' ? props.cx : 0;
              const cy = typeof props.cy === 'number' ? props.cy : 0;
              const fill = typeof props.fill === 'string' ? props.fill : 'currentColor';
              const clickThrough = payload.clickThrough === true;
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={4}
                  fill={fill}
                  stroke="transparent"
                  strokeWidth={0}
                  pointerEvents={clickThrough ? 'none' : 'auto'}
                  data-point-id={id}
                  data-x={x ?? undefined}
                  data-y={y ?? undefined}
                  data-selected="false"
                  className="cursor-pointer"
                  onClick={() => {
                    if (suppressClickRef.current) return;
                    if (id) onToggleSelectedId(id);
                  }}
                />
              );
            }}
          />
          <Scatter
            data={restSelected}
            isAnimationActive={false}
            animationDuration={0}
            shape={(props: ScatterShapeProps) => {
              const payload =
                typeof props.payload === 'object' && props.payload !== null ? (props.payload as ScatterPayload) : {};
              const id = String(payload.id ?? '');
              const x = typeof payload.x === 'number' ? payload.x : null;
              const y = typeof payload.y === 'number' ? payload.y : null;
              const cx = typeof props.cx === 'number' ? props.cx : 0;
              const cy = typeof props.cy === 'number' ? props.cy : 0;
              const fill = typeof props.fill === 'string' ? props.fill : 'currentColor';
              const clickThrough = payload.clickThrough === true;
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={6}
                  fill={fill}
                  stroke="hsl(var(--foreground))"
                  strokeWidth={1.75}
                  pointerEvents={clickThrough ? 'none' : 'auto'}
                  data-point-id={id}
                  data-x={x ?? undefined}
                  data-y={y ?? undefined}
                  data-selected="true"
                  className="cursor-pointer"
                  onClick={() => {
                    if (suppressClickRef.current) return;
                    if (id) onToggleSelectedId(id);
                  }}
                />
              );
            }}
          />
          <Scatter
            data={topSelected}
            isAnimationActive={false}
            animationDuration={0}
            shape={(props: ScatterShapeProps) => {
              const payload =
                typeof props.payload === 'object' && props.payload !== null ? (props.payload as ScatterPayload) : {};
              const id = String(payload.id ?? '');
              const x = typeof payload.x === 'number' ? payload.x : null;
              const y = typeof payload.y === 'number' ? payload.y : null;
              const cx = typeof props.cx === 'number' ? props.cx : 0;
              const cy = typeof props.cy === 'number' ? props.cy : 0;
              const fill = typeof props.fill === 'string' ? props.fill : 'currentColor';
              const clickThrough = payload.clickThrough === true;
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={7}
                  fill={fill}
                  stroke="hsl(var(--foreground))"
                  strokeWidth={2}
                  pointerEvents={clickThrough ? 'none' : 'auto'}
                  data-point-id={id}
                  data-x={x ?? undefined}
                  data-y={y ?? undefined}
                  data-selected="true"
                  className="cursor-pointer"
                  onClick={() => {
                    if (suppressClickRef.current) return;
                    if (id) onToggleSelectedId(id);
                  }}
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
        {activeBrush && fitsState
          ? (() => {
              const rect = brushToRectPx(activeBrush, fitsState);
              if (rect.width < 2 || rect.height < 2) return null;
              return (
                <rect
                  x={rect.left}
                  y={rect.top}
                  width={rect.width}
                  height={rect.height}
                  fill="hsl(var(--foreground) / 0.08)"
                  stroke="hsl(var(--foreground) / 0.6)"
                  strokeWidth={1.5}
                  rx={2}
                />
              );
            })()
          : null}
      </svg>
    </div>
  );
}
