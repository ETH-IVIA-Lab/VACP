import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import { domainToInterval, getInterval2dDomains } from '../domains';
import type { MosaicSpecPlaybookContext } from './types';

function findInterval2d(ctx: MosaicSpecPlaybookContext): { plotId: string; interactorId: string; plotIdx: number } | null {
  const plotIdx = ctx.plots.findIndex((p) => p.plot.interactors.some((i) => i.constructor?.name === 'Interval2D'));
  if (plotIdx < 0) return null;
  const plot = ctx.plots[plotIdx]!;
  const id = plot.plot.interactors.findIndex((i) => i.constructor?.name === 'Interval2D');
  if (id < 0) return null;
  return { plotId: plot.plotId, interactorId: String(id), plotIdx };
}

export function buildAthletesPlaybook(ctx: MosaicSpecPlaybookContext): VacpPlaybook[] {
  const interval = findInterval2d(ctx);
  const domains = interval ? getInterval2dDomains(ctx.plots[interval.plotIdx]!.plot, Number(interval.interactorId)) : null;
  const x = domains ? domainToInterval(domains.x, [0.35, 0.65]) : ([0, 1] as const);
  const y = domains ? domainToInterval(domains.y, [0.35, 0.65]) : ([0, 1] as const);

  const b = playbook({
    id: 'athletes-dashboard',
    title: 'Playbook: Olympic Athletes (filter + brush)',
    description: 'Filter athletes by sport/sex and brush a region in the scatterplot (weight vs height).',
  })
    .action('Clear Sport menu', { name: 'mosaic.clear_input', params: { ref: `${ctx.viewBase}/input/0` } })
    .action('Clear Sex menu', { name: 'mosaic.clear_input', params: { ref: `${ctx.viewBase}/input/1` } })
    .action('Clear Name search', { name: 'mosaic.clear_input', params: { ref: `${ctx.viewBase}/input/2` } })
    .action('Pick a Sport (first non-default option)', {
      name: 'mosaic.set_input_option_index',
      params: { ref: `${ctx.viewBase}/input/0`, index: 1 },
    })
    .action('Pick Sex (first option)', { name: 'mosaic.set_input_option_index', params: { ref: `${ctx.viewBase}/input/1`, index: 1 } })
    .action('Search by name substring', { name: 'mosaic.set_input_value', params: { ref: `${ctx.viewBase}/input/2`, value: 'a' } });

  if (interval) {
    b.action('Clear scatter brush', { name: 'mosaic.clear_interval_2d', params: { plotId: interval.plotId, interactorId: interval.interactorId } })
      .action('Brush a central region (weight × height)', {
        name: 'mosaic.set_interval_2d',
        params: { plotId: interval.plotId, interactorId: interval.interactorId, x0: x[0], x1: x[1], y0: y[0], y1: y[1] },
      });
  }

  b.note('Done', 'The menu filters and (if available) scatter brush remain active so the result stays visible after “Run all”.');

  return [b.build()];
}
