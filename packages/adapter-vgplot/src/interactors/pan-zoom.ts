import type { VacpActionCall } from '@vacp/protocol';

import type { VgplotPlotLike } from '../types.js';
import { awaitPlotUpdate } from './plot-update.js';

type PanZoomInteractor = {
  constructor?: { name?: string };
  xsel?: { update?: (v: unknown) => unknown; value?: unknown };
  ysel?: { update?: (v: unknown) => unknown; value?: unknown };
  xfield?: unknown;
  yfield?: unknown;
  xscale?: unknown;
  yscale?: unknown;
  clause?: (value: unknown, field2: unknown, scale2: unknown) => unknown;
};

/**
 * Programmatic control of vgplot pan/zoom.
 *
 * Pan/zoom is a view-domain operation. VACP still exposes it so agents can
 * navigate the view with the same semantics as humans ("zoom into this range").
 */
export async function executePanZoomAction(plot: VgplotPlotLike, call: VacpActionCall) {
  const params = (call.params ?? {}) as Record<string, unknown>;
  const interactorId = String(params.interactorId ?? '');
  const interactor = plot.interactors[Number(interactorId)];

  if (!interactor) throw new Error(`Unknown interactorId: ${interactorId}`);

  const ctorName = interactor.constructor?.name ?? 'Interactor';

  if (ctorName !== 'PanZoom') throw new Error(`Expected PanZoom interactor, got ${ctorName}`);

  const anyI = interactor as PanZoomInteractor;

  if (typeof anyI.clause !== 'function') throw new Error('PanZoom interactor is missing clause(value, field, scale)');

  const x0 = params.x0;
  const x1 = params.x1;
  const y0 = params.y0;
  const y1 = params.y1;

  const setAxis = (axis: 'x' | 'y', domain: unknown) => {
    const sel = axis === 'x' ? anyI.xsel : anyI.ysel;
    const field = axis === 'x' ? anyI.xfield : anyI.yfield;
    const scale = axis === 'x' ? anyI.xscale : anyI.yscale;

    if (!sel || typeof sel.update !== 'function') throw new Error(`PanZoom interactor is missing ${axis}sel.update`);
    sel.update(anyI.clause!(domain, field, scale));
  };

  if (call.name === 'vgplot.clear_pan_zoom') {
    // Best-effort: clear both domains.
    setAxis('x', null);
    setAxis('y', null);
    await awaitPlotUpdate(plot);

    return { cleared: true };
  }

  if (call.name === 'vgplot.set_pan_zoom') {
    const didX = x0 !== undefined || x1 !== undefined;
    const didY = y0 !== undefined || y1 !== undefined;

    if (!didX && !didY) throw new Error('Expected at least one axis domain (x0/x1 and/or y0/y1)');

    if (didX) {
      const a = Number(x0);
      const b = Number(x1);

      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('Expected numeric x0/x1');
      setAxis('x', [a, b]);
    }

    if (didY) {
      const a = Number(y0);
      const b = Number(y1);

      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('Expected numeric y0/y1');
      setAxis('y', [a, b]);
    }

    await awaitPlotUpdate(plot);

    return { set: true };
  }

  throw new Error(`Unsupported pan/zoom action: ${call.name}`);
}
