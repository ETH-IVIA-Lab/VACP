import type { VacpActionCall } from '@vacp/core';

import type { VgplotPlotLike } from '../types';

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

/**
 * Interval interactors are the primary vgplot selection primitives.
 *
 * We set values in *domain units* and let the interactor translate to pixels /
 * selection clauses internally.
 */
export async function executeIntervalAction(plot: VgplotPlotLike, call: VacpActionCall): Promise<unknown> {
  const params = (call.params ?? {}) as Record<string, unknown>;
  const interactorId = String(params.interactorId ?? '');
  const interactor = plot.interactors[Number(interactorId)];
  if (!interactor) throw new Error(`Unknown interactorId: ${interactorId}`);

  const ctorName = interactor.constructor?.name ?? 'Interactor';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyI = interactor as any;

  if (call.name === 'mosaic.clear_interval_1d' && ctorName === 'Interval1D') {
    if (typeof anyI.publish === 'function') anyI.publish(null);
    else anyI.value = undefined;
    return { cleared: true };
  }

  if (call.name === 'mosaic.clear_interval_2d' && ctorName === 'Interval2D') {
    if (typeof anyI.publish === 'function') anyI.publish(null);
    else anyI.value = undefined;
    return { cleared: true };
  }

  if (call.name === 'mosaic.set_interval_1d' && ctorName === 'Interval1D') {
    const min = parseDomainValue(params.min);
    const max = parseDomainValue(params.max);
    anyI.value = [min, max];
    if (anyI.g && anyI.brush && anyI.scale) {
      const px = [min, max].map((v: DomainValue) => anyI.scale.apply(v));
      anyI.g.call(anyI.brush.moveSilent, px);
    }
    if (typeof anyI.selection?.update === 'function' && typeof anyI.clause === 'function') {
      anyI.selection.update(anyI.clause([min, max]));
    }
    return { set: true };
  }

  if (call.name === 'mosaic.set_interval_2d' && ctorName === 'Interval2D') {
    const x0 = parseDomainValue(params.x0);
    const x1 = parseDomainValue(params.x1);
    const y0 = parseDomainValue(params.y0);
    const y1 = parseDomainValue(params.y1);
    anyI.value = [
      [x0, x1],
      [y0, y1],
    ];
    if (anyI.g && anyI.brush && anyI.xscale && anyI.yscale) {
      const px = [x0, x1].map((v: DomainValue) => anyI.xscale.apply(v));
      const py = [y0, y1].map((v: DomainValue) => anyI.yscale.apply(v));
      anyI.g.call(anyI.brush.moveSilent, [
        [Math.min(...px), Math.min(...py)],
        [Math.max(...px), Math.max(...py)],
      ]);
    }
    if (typeof anyI.selection?.update === 'function' && typeof anyI.clause === 'function') {
      anyI.selection.update(anyI.clause(anyI.value));
    }
    return { set: true };
  }

  throw new Error(`Unsupported interval action for interactor ${ctorName}: ${call.name}`);
}
