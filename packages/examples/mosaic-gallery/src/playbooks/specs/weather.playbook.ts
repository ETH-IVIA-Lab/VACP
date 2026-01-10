import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import { getInterval1dDomain } from '../domains';
import type { MosaicSpecPlaybookContext } from './types';

function clampDate(d: Date, lo: Date, hi: Date): Date {
  const t = d.getTime();
  return new Date(Math.max(lo.getTime(), Math.min(hi.getTime(), t)));
}

function clampNumber(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function findInterval1d(
  ctx: MosaicSpecPlaybookContext,
): { plotId: string; interactorId: string; plotIdx: number } | null {
  // Seattle weather: brush on the main scatter plot (first plot).
  const plotIdx = ctx.plots.findIndex((p) => p.plot.interactors.some((i) => i.constructor?.name === 'Interval1D'));
  if (plotIdx < 0) return null;
  const plot = ctx.plots[plotIdx]!;
  const id = plot.plot.interactors.findIndex((i) => i.constructor?.name === 'Interval1D');
  if (id < 0) return null;
  return { plotId: plot.plotId, interactorId: String(id), plotIdx };
}

function summerRangeFromDomain(domain: [number | Date, number | Date]): { min: number | Date; max: number | Date } {
  const [d0, d1] = domain;
  if (d0 instanceof Date && d1 instanceof Date) {
    const year = d0.getFullYear();
    const lo = new Date(year, 5, 1);
    const hi = new Date(year, 8, 0, 23, 59, 59, 999); // last day of Aug
    return { min: clampDate(lo, d0, d1), max: clampDate(hi, d0, d1) };
  }

  // Common fallback: day-of-year (0..365-ish).
  const n0 = typeof d0 === 'number' ? d0 : 0;
  const n1 = typeof d1 === 'number' ? d1 : 365;
  const lo = 151; // Jun 1
  const hi = 243; // Aug 31
  return { min: clampNumber(lo, n0, n1), max: clampNumber(hi, n0, n1) };
}

export function buildWeatherPlaybook(ctx: MosaicSpecPlaybookContext): VacpPlaybook[] {
  const interval = findInterval1d(ctx);
  if (!interval) return [];

  const domain = getInterval1dDomain(ctx.plots[interval.plotIdx]!.plot, Number(interval.interactorId));
  const range = domain ? summerRangeFromDomain(domain) : { min: 151, max: 243 };

  return [
    playbook({
      id: 'weather-jacket-days',
      title: 'Playbook: Seattle Weather (summer jacket days)',
      description:
        'Answer: “How many days in the summer where I need a jacket?” by filtering to summer (Jun–Aug) and selecting rain/drizzle/snow.',
    })
      .action('Clear brush selection (clean slate)', {
        name: 'mosaic.clear_interval_1d',
        params: { plotId: interval.plotId, interactorId: interval.interactorId },
      })
      .action('Clear legend selection (clean slate)', {
        name: 'mosaic.clear_legend_toggle',
        params: { plotId: interval.plotId, channel: 'color' },
      })
      .action('Select summer months (Jun–Aug)', {
        name: 'mosaic.set_interval_1d',
        params: { plotId: interval.plotId, interactorId: interval.interactorId, min: range.min, max: range.max },
      })
      .action('Filter to jacket days (rain, drizzle, snow)', {
        name: 'mosaic.set_legend_toggle',
        params: { plotId: interval.plotId, channel: 'color', value: ['rain', 'drizzle', 'snow'] },
      })
      .build(),
  ];
}
