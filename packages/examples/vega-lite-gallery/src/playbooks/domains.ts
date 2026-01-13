export function clampNumber(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function clampRange(range: readonly [number, number], lo: number, hi: number): [number, number] {
  const a = clampNumber(range[0], lo, hi);
  const b = clampNumber(range[1], lo, hi);
  return a <= b ? [a, b] : [b, a];
}

export type Brush2D = { x: [number, number]; y: [number, number] };

export const CLUSTER_CENTERS = {
  // horsepower (x) vs mpg (y) clusters from `makeCarLikeData()`
  economy: { x: 65, y: 36 },
  compact: { x: 95, y: 28 },
  mid: { x: 125, y: 22 },
  muscle: { x: 180, y: 15 },
} as const;

export function brushAround(
  point: { x: number; y: number },
  span: { x: number; y: number } = { x: 22, y: 7.5 },
): Brush2D {
  const x = clampRange([point.x - span.x, point.x + span.x], 40, 230);
  const y = clampRange([point.y - span.y, point.y + span.y], 8, 48);
  return { x, y };
}
