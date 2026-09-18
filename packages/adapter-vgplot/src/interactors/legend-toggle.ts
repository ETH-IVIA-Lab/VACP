import type { VacpActionCall } from '@vacp/protocol';

import type { VgplotPlotLike } from '../types.js';

function normalizeLegendEntries(plot: VgplotPlotLike): any[] {
  const raw = plot.legends;

  if (!Array.isArray(raw)) return [];

  return raw.map((x) => (x && typeof x === 'object' && 'legend' in x ? (x as any).legend : x)).filter(Boolean);
}

function normalizeToggleValue(raw: unknown): unknown[][] | null {
  if (raw === null || raw === undefined) return null;

  if (Array.isArray(raw) && raw.length === 0) return null;

  if (Array.isArray(raw) && Array.isArray(raw[0])) return raw;

  if (Array.isArray(raw)) return raw.map((v) => [v]);

  return [[raw]];
}

/**
 * Programmatic control of interactive legends.
 *
 * vgplot legends are separate from plot interactors (they live in `plot.legends`),
 * but they still drive the same VGPlot Selection system. In practice, that makes
 * them the most "intuitive" way to set categorical cross-filters.
 */
export async function executeLegendToggleAction(plot: VgplotPlotLike, call: VacpActionCall) {
  const params = (call.params ?? {}) as Record<string, unknown>;
  const channel = typeof params.channel === 'string' && params.channel ? params.channel : null;

  const legends = normalizeLegendEntries(plot);
  const interactive = legends.filter((l) => !!(l as any).selection);

  const match = channel
    ? interactive.find((l) => String((l as any).channel ?? '').toLowerCase() === channel.toLowerCase())
    : interactive[0];

  if (!match)
    throw new Error(channel ? `No interactive legend found for channel: ${channel}` : 'No interactive legend');

  const handler = (match as any).handler;

  if (!handler) throw new Error('Legend interactor is not initialized yet (handler missing)');

  if ((handler.constructor?.name ?? '') !== 'Toggle') {
    throw new Error(`Expected legend Toggle handler, got ${handler.constructor?.name ?? 'unknown'}`);
  }

  if (typeof handler.selection?.update !== 'function' || typeof handler.clause !== 'function') {
    throw new Error('Legend Toggle handler is missing selection.update/clause');
  }

  if (call.name === 'vgplot.clear_legend_toggle') {
    handler.value = null;
    handler.selection.update(handler.clause(null));
    await Promise.resolve(plot.update?.());

    return { cleared: true, channel: (match as any).channel ?? null };
  }

  if (call.name === 'vgplot.set_legend_toggle') {
    const value = normalizeToggleValue(params.value);
    handler.value = value;
    handler.selection.update(handler.clause(value));
    await Promise.resolve(plot.update?.());

    return { set: true, channel: (match as any).channel ?? null };
  }

  throw new Error(`Unsupported legend toggle action: ${call.name}`);
}
