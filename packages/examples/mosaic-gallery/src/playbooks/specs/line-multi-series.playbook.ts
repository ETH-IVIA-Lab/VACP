import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import type { MosaicSpecPlaybookContext } from './types';

function findNearest(plot: MosaicSpecPlaybookContext['plots'][number]): number {
  return plot.plot.interactors.findIndex((i) => i.constructor?.name === 'Nearest');
}

function readNumericDomain(scale: unknown): [number, number] | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyScale = scale as any;
  const raw = typeof anyScale?.domain === 'function' ? anyScale.domain() : anyScale?.domain;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const a = Number(raw[0]);
  const b = Number(raw[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a <= b ? [a, b] : [b, a];
}

function readDateDomain(scale: unknown): [Date, Date] | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyScale = scale as any;
  const raw = typeof anyScale?.domain === 'function' ? anyScale.domain() : anyScale?.domain;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const a = raw[0] instanceof Date ? raw[0] : new Date(raw[0]);
  const b = raw[1] instanceof Date ? raw[1] : new Date(raw[1]);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return a.getTime() <= b.getTime() ? [a, b] : [b, a];
}

function pickNearestValue(plot: MosaicSpecPlaybookContext['plots'][number], nearestIdx: number, t: number): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyI = plot.plot.interactors[nearestIdx] as any;
  const scale = anyI?.xscale ?? anyI?.scale ?? null;
  const d = readDateDomain(scale);
  if (d) return new Date(d[0].getTime() + (d[1].getTime() - d[0].getTime()) * t);
  const n = readNumericDomain(scale);
  if (n) return n[0] + (n[1] - n[0]) * t;
  return anyI?.value?.[0] ?? anyI?.value ?? 0;
}

export function buildLineMultiSeriesPlaybook(ctx: MosaicSpecPlaybookContext): VacpPlaybook[] {
  const plot = ctx.plots[0];
  if (!plot) return [];
  const nearestIdx = findNearest(plot);
  if (nearestIdx < 0) {
    // Still provide a playbook, but keep it informational if we can't drive the hover selection.
    return [
      playbook({
        id: 'line-multi-series-hover',
        title: 'Playbook: Line Multi-Series (hover to inspect)',
        description: 'Hover over the chart to highlight the closest series/point; then compare series by moving along time.',
      })
        .step('Move the pointer over the chart', { description: 'The nearest series should highlight and show annotations.' })
        .step('Hover near an earlier year', { description: 'Compare how series diverge early vs late.' })
        .step('Hover near a later year', { description: 'Observe which metro divisions have higher unemployment.' })
        .build(),
    ];
  }

  const a = pickNearestValue(plot, nearestIdx, 0.35);
  const b = pickNearestValue(plot, nearestIdx, 0.75);

  return [
    playbook({
      id: 'line-multi-series-hover',
      title: 'Playbook: Line Multi-Series (hover to inspect)',
      description: 'Programmatically set the hover/nearest selection to inspect different times and leave the hover active.',
    })
      .action('Clear hover', { name: 'mosaic.clear_nearest', params: { plotId: plot.plotId, interactorId: String(nearestIdx) } })
      .action('Hover near an earlier time', { name: 'mosaic.set_nearest', params: { plotId: plot.plotId, interactorId: String(nearestIdx), value: a } })
      .action('Hover near a later time', { name: 'mosaic.set_nearest', params: { plotId: plot.plotId, interactorId: String(nearestIdx), value: b } })
      .build(),
  ];
}
