/** Wilson 95% interval for a pass rate. Stays inside [0, 1] and behaves at small n. */
export function wilson(passes: number, n: number, z = 1.96) {
  if (!n) return { rate: Number.NaN, lo: Number.NaN, hi: Number.NaN };
  const rate = passes / n;
  const denominator = 1 + (z * z) / n;
  const centre = (rate + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((rate * (1 - rate)) / n + (z * z) / (4 * n * n))) / denominator;
  return { rate, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

export function median(values: readonly number[]): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Per-case mean difference between two variants with a 95% t interval over cases. Between-case
 * variance cancels, so this resolves smaller changes than two unpaired pass-rate intervals.
 */
export function pairedDelta(variant: ReadonlyMap<string, number>, reference: ReadonlyMap<string, number>) {
  const deltas = [...variant].flatMap(([id, mean]) => {
    const other = reference.get(id);
    return other === undefined ? [] : [mean - other];
  });
  const n = deltas.length;
  if (n < 2) return { mean: n ? deltas[0]! : Number.NaN, lo: Number.NaN, hi: Number.NaN, n, significant: false };
  const mean = deltas.reduce((sum, delta) => sum + delta, 0) / n;
  const sd = Math.sqrt(deltas.reduce((sum, delta) => sum + (delta - mean) ** 2, 0) / (n - 1));
  const t = n > 30 ? 1.96 : ([12.71, 4.3, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23][n - 2] ?? 2.1);
  const half = (t * sd) / Math.sqrt(n);
  return { mean, lo: mean - half, hi: mean + half, n, significant: mean - half > 0 || mean + half < 0 };
}
