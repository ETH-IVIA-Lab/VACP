/**
 * Shared synthetic datasets for the Vega-Lite gallery.
 *
 * The goal is not statistical rigor; it's to create data that produces
 * meaningful visual + interactive behavior:
 * - non-uniform structure (clusters / correlations) so selections are obvious
 * - jitter so plots don't look like perfect grids
 * - per-point `size` so point-size params actually show an effect
 */

export type ClusterDatum = { id: number; x: number; y: number; group: string; size: number };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Box–Muller transform.
function randn(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function jittered(value: number, sigma: number): number {
  return value + randn() * sigma;
}

function bumpSize(): number {
  // A stable, bounded multiplier around 1.0 (roughly 0.6..1.7).
  return clamp(1 + randn() * 0.35, 0.6, 1.7);
}

export function makeClusteredPoints(args?: { n?: number; groups?: string[] }): ClusterDatum[] {
  const n = args?.n ?? 520;
  const groups = args?.groups ?? ['A', 'B', 'C', 'D'];

  // Fixed cluster centers so playbooks can apply predictable brushes.
  const centers: Array<{ x: number; y: number }> = [
    { x: 22, y: 28 },
    { x: 70, y: 22 },
    { x: 30, y: 78 },
    { x: 78, y: 72 },
  ];

  const out: ClusterDatum[] = [];
  for (let i = 0; i < n; i++) {
    const g = groups[i % groups.length] ?? 'A';
    const c = centers[i % centers.length] ?? centers[0]!;

    // Group-dependent shape: make one axis tighter/looser per group so
    // different brushes "feel" different.
    const gx = g.charCodeAt(0) % 2 === 0 ? 7 : 10;
    const gy = g.charCodeAt(0) % 2 === 0 ? 10 : 7;

    const x = clamp(jittered(c.x, gx), 0, 100);
    const y = clamp(jittered(c.y, gy), 0, 100);
    out.push({ id: i, x, y, group: g, size: bumpSize() });
  }
  return out;
}

export type CategoryDatum = { category: string; value: number };

export function makeCategoryValues(): CategoryDatum[] {
  const cats = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  return cats.map((category, i) => {
    const wave = 55 + 25 * Math.sin((i / (cats.length - 1)) * Math.PI);
    const noise = randn() * 6;
    return { category, value: Math.round(clamp(wave + noise, 8, 100)) };
  });
}

export type CarDatum = {
  id: number;
  horsepower: number;
  mpg: number;
  weight: number;
  year: number;
  origin: 'US' | 'EU' | 'JP';
  size: number;
};

const CAR_CENTERS: Array<{ horsepower: number; mpg: number; weight: number; origin: CarDatum['origin'] }> = [
  { horsepower: 65, mpg: 36, weight: 2150, origin: 'JP' },
  { horsepower: 95, mpg: 28, weight: 2600, origin: 'EU' },
  { horsepower: 125, mpg: 22, weight: 3050, origin: 'US' },
  { horsepower: 180, mpg: 15, weight: 3650, origin: 'US' },
];

export function makeCarLikeData(args?: { n?: number; origins?: Array<CarDatum['origin']> }): CarDatum[] {
  const n = args?.n ?? 420;
  const origins = args?.origins ?? ['US', 'EU', 'JP'];

  const out: CarDatum[] = [];
  for (let i = 0; i < n; i++) {
    const center = CAR_CENTERS[i % CAR_CENTERS.length] ?? CAR_CENTERS[0]!;
    const origin = origins[i % origins.length] ?? center.origin;

    const horsepower = clamp(jittered(center.horsepower, 16), 40, 230);
    const mpg = clamp(jittered(center.mpg, 4.25), 8, 48);
    const weight = clamp(jittered(center.weight, 260), 1600, 4600);
    const year = clamp(Math.round(jittered(1970 + (i % 13), 1.2)), 1968, 1984);
    out.push({
      id: i,
      horsepower: Math.round(horsepower),
      mpg: Math.round(mpg * 10) / 10,
      weight: Math.round(weight),
      year,
      origin,
      size: bumpSize(),
    });
  }

  return out;
}
