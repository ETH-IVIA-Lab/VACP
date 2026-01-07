import type { VacpActionCall } from '@vacp/core';

import type { VgplotPlotLike } from '../types';

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
    const min = Number(params.min);
    const max = Number(params.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error('min/max must be numbers');
    anyI.value = [min, max];
    if (anyI.g && anyI.brush && anyI.scale) {
      const px = [min, max].map((v: number) => anyI.scale.apply(v));
      anyI.g.call(anyI.brush.moveSilent, px);
    }
    if (typeof anyI.selection?.update === 'function' && typeof anyI.clause === 'function') {
      anyI.selection.update(anyI.clause([min, max]));
    }
    return { set: true };
  }

  if (call.name === 'mosaic.set_interval_2d' && ctorName === 'Interval2D') {
    const x0 = Number(params.x0);
    const x1 = Number(params.x1);
    const y0 = Number(params.y0);
    const y1 = Number(params.y1);
    if (![x0, x1, y0, y1].every(Number.isFinite)) throw new Error('x0/x1/y0/y1 must be numbers');
    anyI.value = [
      [x0, x1],
      [y0, y1],
    ];
    if (anyI.g && anyI.brush && anyI.xscale && anyI.yscale) {
      const px = [x0, x1].map((v: number) => anyI.xscale.apply(v));
      const py = [y0, y1].map((v: number) => anyI.yscale.apply(v));
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
