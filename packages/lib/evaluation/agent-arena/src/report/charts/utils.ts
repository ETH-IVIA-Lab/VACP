import type { ArenaReportTheme } from './types.js';

export function percentTick(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function intTick(value: number) {
  return fmtNumber(value);
}

export function fmtPct(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function fmtNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

export function fmtCompact(value: number) {
  if (!Number.isFinite(value)) return 'n/a';
  const abs = Math.abs(value);
  if (abs >= 100_000) return `${Math.round(value / 1000)}k`;
  if (abs >= 10_000) return `${Math.round(value / 100) / 10}k`;
  return fmtNumber(Math.round(value));
}

export function svgArea(svg: SVGSVGElement) {
  const w = Number(svg.getAttribute('width'));
  const h = Number(svg.getAttribute('height'));
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return w * h;
  return 0;
}

export function quantiles(values: number[], ps: number[]) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return ps.map(() => 0);
  return ps.map((p) => {
    const pos = (xs.length - 1) * p;
    const base = Math.floor(pos);
    const rest = pos - base;
    const a = xs[base] ?? 0;
    const b = xs[base + 1] ?? a;
    return a + rest * (b - a);
  });
}

export function bucketIndex(value: number, qs: number[]) {
  if (!Number.isFinite(value)) return 0;
  let i = 0;
  for (const q of qs) if (value > q) i += 1;
  return Math.min(i, qs.length);
}

export function meanNumber(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function medianNumber(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function maxOf<T>(rows: T[], get: (row: T) => number) {
  let best = 0;
  for (const row of rows) {
    const v = get(row);
    if (!Number.isFinite(v)) continue;
    if (v > best) best = v;
  }
  return best;
}

export function paddedMax(value: number, pad = 0.2, fallback = 1) {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value * (1 + pad);
}

export function tickStep(n: number) {
  if (n > 40) return 5;
  if (n > 25) return 3;
  if (n > 18) return 2;
  return 1;
}

export function marginLeftForLabels(labels: string[], theme: ArenaReportTheme, bounds: { min: number; max: number }) {
  const est = Math.max(...labels.map((l) => estimateTextWidthPx(l, theme.fontSizePx)));
  const pad = 34;
  return clamp(bounds.min, pad + est, bounds.max);
}

export function estimateTextWidthPx(text: string, fontSizePx: number) {
  // Robust-enough for layout: most sans fonts are ~0.55–0.65em per character.
  return Math.ceil(text.length * fontSizePx * 0.62);
}

export function clamp(min: number, value: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function resolveLayout(
  theme: ArenaReportTheme,
  defaults: {
    height: number;
    marginLeft: number;
    marginRight: number;
    marginTop: number;
    marginBottom: number;
    width?: number;
  },
  overrides: {
    width?: number;
    height?: number;
    marginLeft?: number;
    marginRight?: number;
    marginTop?: number;
    marginBottom?: number;
  } = {},
) {
  return {
    width: overrides.width ?? defaults.width ?? theme.width,
    height: overrides.height ?? defaults.height,
    marginLeft: overrides.marginLeft ?? defaults.marginLeft,
    marginRight: overrides.marginRight ?? defaults.marginRight,
    marginTop: overrides.marginTop ?? defaults.marginTop,
    marginBottom: overrides.marginBottom ?? defaults.marginBottom,
  };
}

export function isDark(hex: string) {
  const { r, g, b } = parseHex(hex);
  // WCAG-ish relative luminance; threshold tuned for these palettes.
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum < 0.5;
}

export function parseHex(hex: string) {
  const cleaned = hex.replace('#', '');
  if (cleaned.length === 3) {
    const r = parseInt(cleaned[0] + cleaned[0], 16);
    const g = parseInt(cleaned[1] + cleaned[1], 16);
    const b = parseInt(cleaned[2] + cleaned[2], 16);
    return { r, g, b };
  }
  if (cleaned.length === 6) {
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    return { r, g, b };
  }
  return { r: 0, g: 0, b: 0 };
}

export function normalize01(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0.5;
  return clamp(0, (value - min) / (max - min), 1);
}

export function interpolatePalette(palette: string[], t: number) {
  if (!palette.length) return '#000000';
  if (palette.length === 1) return palette[0];
  const clamped = clamp(0, t, 1);
  const scaled = clamped * (palette.length - 1);
  const leftIndex = Math.floor(scaled);
  const rightIndex = Math.min(palette.length - 1, leftIndex + 1);
  const localT = scaled - leftIndex;
  return interpolateHexColor(palette[leftIndex], palette[rightIndex], localT);
}

export function linearTicks(min: number, max: number, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (count <= 1 || max <= min) return [min];
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(min + ((max - min) * i) / (count - 1));
  return out;
}

export function continuousLegendStops(min: number, max: number, palette: string[]) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !palette.length) return [];
  if (palette.length === 1 || max <= min)
    return [
      { value: min, fill: palette[0] },
      { value: max, fill: palette[0] },
    ];
  return palette.map((fill, i) => ({
    value: min + ((max - min) * i) / (palette.length - 1),
    fill,
  }));
}

function interpolateHexColor(a: string, b: string, t: number) {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const r = Math.round(ca.r + (cb.r - ca.r) * t);
  const g = Math.round(ca.g + (cb.g - ca.g) * t);
  const b2 = Math.round(ca.b + (cb.b - ca.b) * t);
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b2)}`;
}

function toHex2(value: number) {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0');
}
