import type { VgplotLegendLike, VgplotPlotLike } from './types';

/** Resolve Mosaic legend wrappers once for discovery, execution, and presentation. */
export function plotLegends(plot: VgplotPlotLike): VgplotLegendLike[] {
  const result: VgplotLegendLike[] = [];
  for (const entry of plot.legends ?? []) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = 'legend' in entry ? entry.legend : undefined;
    if (candidate && typeof candidate === 'object' && 'channel' in candidate && typeof candidate.channel === 'string')
      result.push(candidate as VgplotLegendLike);
  }
  return result;
}

/** Match the value Mosaic uses to paint linked legend instances. */
export function legendValue(legend: VgplotLegendLike): unknown {
  const selection = legend.selection;
  if (!selection) return undefined;
  return !selection.single && selection.valueFor && legend.handler
    ? selection.valueFor(legend.handler)
    : selection.value;
}
