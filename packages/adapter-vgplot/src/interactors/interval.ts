import type { VacpActionCall } from '@vacp/protocol';

import type { VgplotPlotLike, VgplotScaleLike } from '../types.js';
import { awaitPlotUpdate } from './plot-update.js';

type DomainValue = number | Date;

function parseDomainValue(value: unknown): DomainValue {
  if (value instanceof Date) return value;

  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const n = Number(trimmed);

      if (Number.isFinite(n)) return n;
    }

    const t = Date.parse(trimmed);

    if (Number.isFinite(t)) return new Date(t);
  }

  throw new Error('Expected a number or a date-like string');
}

function dayOfYear0UTC(d: Date): number {
  const year = d.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const t = Date.UTC(year, d.getUTCMonth(), d.getUTCDate());

  return Math.floor((t - start) / 86_400_000);
}

function readScaleDomain(scale: VgplotScaleLike | undefined): unknown[] | null {
  if (!scale) return null;
  const anyScale = scale;
  const raw = typeof anyScale.domain === 'function' ? anyScale.domain() : anyScale.domain;

  return Array.isArray(raw) ? raw : null;
}

function normalizeToScaleDomain(value: DomainValue, scale: VgplotScaleLike | undefined): DomainValue {
  const raw = readScaleDomain(scale);

  if (!raw || raw.length < 2) return value;
  const d0 = raw[0];
  const d1 = raw[raw.length - 1];

  // Date domain: accept epoch millis numbers and convert.
  if (d0 instanceof Date || d1 instanceof Date) {
    if (value instanceof Date) return value;

    if (typeof value === 'number' && Math.abs(value) > 1e10) return new Date(value);

    return value;
  }

  // Numeric domain: common case is day-of-year (0..365-ish). If caller passed a Date or an epoch timestamp,
  // convert to day-of-year so the brush renders correctly and filters match human interaction.
  if (typeof d0 === 'number' && typeof d1 === 'number') {
    const span = Math.abs(d1 - d0);
    const looksLikeDayOfYear = span > 0 && span <= 400 && Math.max(d0, d1) <= 400 && Math.min(d0, d1) >= -1;

    if (!looksLikeDayOfYear) return value;

    if (value instanceof Date) return dayOfYear0UTC(value);

    if (typeof value === 'number' && Math.abs(value) > 1e10) return dayOfYear0UTC(new Date(value));
  }

  return value;
}

/**
 * Interval interactors are the primary vgplot selection primitives.
 *
 * We set values in *domain units* and let the interactor translate to pixels /
 * selection clauses internally.
 */
export async function executeIntervalAction(plot: VgplotPlotLike, call: VacpActionCall) {
  const params = (call.params ?? {}) as Record<string, unknown>;
  const interactorId = String(params.interactorId ?? '');
  const interactor = plot.interactors[Number(interactorId)];

  if (!interactor) throw new Error(`Unknown interactorId: ${interactorId}`);

  const ctorName = interactor.constructor?.name ?? 'Interactor';
  const anyI = interactor;

  if (call.name === 'vgplot.clear_interval_1d' && ctorName === 'Interval1D') {
    // Prefer the same mechanism as human brushing: clear brush visuals + clear the selection clause.
    if (anyI.g && anyI.brush) {
      anyI.g.call(anyI.brush.moveSilent, null);
    }

    anyI.value = undefined;

    if (typeof anyI.selection?.update === 'function' && typeof anyI.clause === 'function') {
      anyI.selection.update(anyI.clause(null));
    } else if (typeof anyI.publish === 'function') {
      anyI.publish(null);
    }

    await awaitPlotUpdate(plot);

    return { cleared: true };
  }

  if (call.name === 'vgplot.clear_interval_2d' && ctorName === 'Interval2D') {
    if (anyI.g && anyI.brush) {
      anyI.g.call(anyI.brush.moveSilent, null);
    }

    anyI.value = undefined;

    if (typeof anyI.selection?.update === 'function' && typeof anyI.clause === 'function') {
      anyI.selection.update(anyI.clause(null));
    } else if (typeof anyI.publish === 'function') {
      anyI.publish(null);
    }

    await awaitPlotUpdate(plot);

    return { cleared: true };
  }

  if (call.name === 'vgplot.set_interval_1d' && ctorName === 'Interval1D') {
    const min = normalizeToScaleDomain(parseDomainValue(params.min), anyI.scale);
    const max = normalizeToScaleDomain(parseDomainValue(params.max), anyI.scale);
    anyI.value = [min, max];

    if (anyI.g && anyI.brush && anyI.scale) {
      const scale = anyI.scale;
      const px = [min, max].map((v: DomainValue) => scale.apply(v));
      anyI.g.call(anyI.brush.moveSilent, px);
    }

    if (typeof anyI.selection?.update === 'function' && typeof anyI.clause === 'function') {
      anyI.selection.update(anyI.clause([min, max]));
    } else if (typeof anyI.publish === 'function') {
      // Fallback: publish if the selection plumbing isn't exposed.
      anyI.publish([min, max]);
    }

    // Ensure VGPlot cross-filters re-run (matching the effect of human brushing).
    await awaitPlotUpdate(plot);

    return { set: true };
  }

  if (call.name === 'vgplot.set_interval_2d' && ctorName === 'Interval2D') {
    const x0 = normalizeToScaleDomain(parseDomainValue(params.x0), anyI.xscale);
    const x1 = normalizeToScaleDomain(parseDomainValue(params.x1), anyI.xscale);
    const y0 = normalizeToScaleDomain(parseDomainValue(params.y0), anyI.yscale);
    const y1 = normalizeToScaleDomain(parseDomainValue(params.y1), anyI.yscale);

    const value = [
      [x0, x1],
      [y0, y1],
    ];

    anyI.value = value;

    if (anyI.g && anyI.brush && anyI.xscale && anyI.yscale) {
      const xscale = anyI.xscale;
      const yscale = anyI.yscale;
      const px = [x0, x1].map((v: DomainValue) => xscale.apply(v));
      const py = [y0, y1].map((v: DomainValue) => yscale.apply(v));
      anyI.g.call(anyI.brush.moveSilent, [
        [Math.min(...px), Math.min(...py)],
        [Math.max(...px), Math.max(...py)],
      ]);
    }

    if (typeof anyI.selection?.update === 'function' && typeof anyI.clause === 'function') {
      anyI.selection.update(anyI.clause(anyI.value));
    } else if (typeof anyI.publish === 'function') {
      anyI.publish(value);
    }

    await awaitPlotUpdate(plot);

    return { set: true };
  }

  throw new Error(`Unsupported interval action for interactor ${ctorName}: ${call.name}`);
}
