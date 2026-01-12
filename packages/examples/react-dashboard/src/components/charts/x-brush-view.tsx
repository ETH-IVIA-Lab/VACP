import { Area, AreaChart, Brush, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { DatasetRow } from '@/datasets/registry';
import type { BrushRange } from '@/state/dashboard-store';
import { toFiniteNumber } from '@/lib/dashboard';

type Props = {
  sortedRows: DatasetRow[];
  xKey: string;
  brush: BrushRange;
  onBrushChange: (range: BrushRange) => void;
};

type BrushTravellerProps = Partial<{
  x: unknown;
  y: unknown;
  width: unknown;
  height: unknown;
}>;

function formatNumberShort(value: unknown): string {
  const v = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(v)) return '';
  const rounded = Math.round(v * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  const s = String(rounded);
  if (s.includes('e') || s.includes('E')) return rounded.toFixed(2).replace(/\.?0+$/, '');
  return s;
}

function sampleTicks(min: number, max: number): string[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (Math.abs(max - min) < 1e-9) return [formatNumberShort(min)];
  const t = [0, 0.25, 0.5, 0.75, 1].map((p) => min + (max - min) * p);
  return t.map(formatNumberShort);
}

function BrushTraveller(props: unknown) {
  const p = typeof props === 'object' && props !== null ? (props as BrushTravellerProps) : {};
  const x = typeof p.x === 'number' ? p.x : 0;
  const y = typeof p.y === 'number' ? p.y : 0;
  const width = typeof p.width === 'number' ? p.width : 0;
  const height = typeof p.height === 'number' ? p.height : 0;
  return (
    <g style={{ cursor: 'ew-resize' }}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={3}
        fill="hsl(var(--background))"
        stroke="hsl(var(--border))"
        strokeWidth={1}
      />
      <line
        x1={x + width / 2 - 3}
        x2={x + width / 2 - 3}
        y1={y + 6}
        y2={y + height - 6}
        stroke="hsl(var(--muted-foreground))"
      />
      <line
        x1={x + width / 2 + 3}
        x2={x + width / 2 + 3}
        y1={y + 6}
        y2={y + height - 6}
        stroke="hsl(var(--muted-foreground))"
      />
    </g>
  );
}

export function XBrushView({ sortedRows, xKey, brush, onBrushChange }: Props) {
  const data = sortedRows
    .map((row, idx) => ({ idx, id: row.id, x: toFiniteNumber(row[xKey]) }))
    .filter((d) => d.x !== null) as Array<{ idx: number; id: string; x: number }>;

  const min = data.length ? Math.min(...data.map((d) => d.x)) : 0;
  const max = data.length ? Math.max(...data.map((d) => d.x)) : 0;
  const pad = Math.max(1e-9, (max - min) * 0.05);
  const domainMin = min - pad;
  const domainMax = max + pad;
  const yTickSamples = sampleTicks(domainMin, domainMax);
  const maxTickChars = yTickSamples.reduce((m, s) => Math.max(m, s.length), 0);
  const yAxisWidth = Math.max(68, Math.min(120, 22 + maxTickChars * 8));
  const leftMargin = Math.max(48, yAxisWidth + 34);

  return (
    <ResponsiveContainer width="100%" height={360}>
      <AreaChart data={data} margin={{ top: 12, right: 12, bottom: 56, left: leftMargin }}>
        <defs>
          <linearGradient id="xBrushFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.6} />
            <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="idx"
          tick={false}
          label={{ value: `rank (sorted by ${xKey})`, position: 'insideBottom', dy: 26 }}
        />
        <YAxis
          domain={[domainMin, domainMax]}
          width={yAxisWidth}
          tickFormatter={formatNumberShort}
          tickMargin={8}
          label={{ value: xKey, angle: -90, position: 'left', offset: 16 }}
        />
        <Tooltip
          formatter={(value) => [value, xKey]}
          labelFormatter={(label, payload) => {
            const p = Array.isArray(payload) ? payload[0]?.payload : undefined;
            return p?.id ? `id: ${String(p.id)}` : String(label);
          }}
        />
        <Area
          type="monotone"
          dataKey="x"
          stroke="hsl(var(--chart-2))"
          fill="url(#xBrushFill)"
          isAnimationActive={false}
          animationDuration={0}
        />
        <Brush
          dataKey="idx"
          height={44}
          travellerWidth={30}
          traveller={<BrushTraveller />}
          startIndex={brush?.startIndex}
          endIndex={brush?.endIndex}
          tickFormatter={(value) => {
            const idx = Number(value);
            const d = Number.isFinite(idx) ? data[idx] : undefined;
            if (!d) return '';
            return formatNumberShort(d.x);
          }}
          onChange={(r) => {
            if (!data.length) return onBrushChange(null);
            if (!r || typeof r.startIndex !== 'number' || typeof r.endIndex !== 'number') return;
            onBrushChange({ startIndex: r.startIndex, endIndex: r.endIndex });
          }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
