import type { VgplotPlotLike } from '@vacp/mosaic';

export async function waitForSvg(root: ParentNode, timeoutMs = 10_000): Promise<SVGElement> {
  const start = performance.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const svg = root.querySelector('svg');
    if (svg) return svg;
    if (performance.now() - start > timeoutMs) throw new Error('Timed out waiting for SVG render');
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
}

export async function waitForSvgMaybe(root: ParentNode, timeoutMs = 1_500): Promise<SVGElement | null> {
  const start = performance.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const svg = root.querySelector('svg');
    if (svg) return svg;
    if (performance.now() - start > timeoutMs) return null;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
}

function numericDomain(scale: unknown): [number, number] | null {
  const anyScale = scale as { domain?: unknown };
  const d = typeof anyScale?.domain === 'function' ? (anyScale.domain as () => unknown)() : anyScale?.domain;
  if (!Array.isArray(d) || d.length < 2) return null;
  const a = Number(d[0]);
  const b = Number(d[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return [a, b];
}

export function pickInterval1D(plots: Array<{ plotId: string; plot: VgplotPlotLike }>): {
  plotId: string;
  interactorId: string;
  domain: [number, number] | null;
} | null {
  for (const { plotId, plot } of plots) {
    for (let i = 0; i < plot.interactors.length; i++) {
      const it = plot.interactors[i];
      if (it.constructor?.name !== 'Interval1D') continue;
      const anyI = it as unknown as { scale?: unknown };
      return { plotId, interactorId: String(i), domain: numericDomain(anyI.scale) };
    }
  }
  return null;
}

export function pickInterval2D(plots: Array<{ plotId: string; plot: VgplotPlotLike }>): {
  plotId: string;
  interactorId: string;
  x: [number, number] | null;
  y: [number, number] | null;
} | null {
  for (const { plotId, plot } of plots) {
    for (let i = 0; i < plot.interactors.length; i++) {
      const it = plot.interactors[i];
      if (it.constructor?.name !== 'Interval2D') continue;
      const anyI = it as unknown as { xscale?: unknown; yscale?: unknown };
      return { plotId, interactorId: String(i), x: numericDomain(anyI.xscale), y: numericDomain(anyI.yscale) };
    }
  }
  return null;
}
