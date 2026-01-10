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
  bottomLeft: { x: 22, y: 28 },
  bottomRight: { x: 70, y: 22 },
  topLeft: { x: 30, y: 78 },
  topRight: { x: 78, y: 72 },
} as const;

export function brushAround(
  point: { x: number; y: number },
  span: { x: number; y: number } = { x: 18, y: 18 },
): Brush2D {
  const x = clampRange([point.x - span.x, point.x + span.x], 0, 100);
  const y = clampRange([point.y - span.y, point.y + span.y], 0, 100);
  return { x, y };
}
