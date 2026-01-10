import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import { domainToInterval, getPanZoom2dDomains } from '../domains';
import type { MosaicSpecPlaybookContext } from './types';

function findPanZoom(plot: MosaicSpecPlaybookContext['plots'][number]): number {
  return plot.plot.interactors.findIndex((i) => i.constructor?.name === 'PanZoom');
}

export function buildPanZoomPlaybook(ctx: MosaicSpecPlaybookContext): VacpPlaybook[] {
  const panPlots = ctx.plots
    .map((p) => ({ ...p, idx: findPanZoom(p) }))
    .filter((p) => p.idx >= 0);
  if (panPlots.length === 0) return [];

  const first = panPlots[0]!;
  const domains = getPanZoom2dDomains(first.plot, first.idx);
  const x = domains?.x ? domainToInterval(domains.x, [0.2, 0.8]) : null;
  const y = domains?.y ? domainToInterval(domains.y, [0.2, 0.8]) : null;

  const b = playbook({
    id: 'pan-zoom-linked',
    title: 'Playbook: Pan & Zoom (linked domains)',
    description: 'Programmatically pan/zoom one plot (linked selections propagate) and leave it zoomed.',
  });

  // Clear all pan/zoom domains.
  for (const p of panPlots) {
    b.action('Clear pan/zoom', { name: 'mosaic.clear_pan_zoom', params: { plotId: p.plotId, interactorId: String(p.idx) } });
  }

  b.action('Zoom into a focused region', {
    name: 'mosaic.set_pan_zoom',
    params: { plotId: first.plotId, interactorId: String(first.idx), x0: x?.[0] ?? null, x1: x?.[1] ?? null, y0: y?.[0] ?? null, y1: y?.[1] ?? null },
  });

  return [b.build()];
}
