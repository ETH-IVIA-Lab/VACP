import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import { domainToInterval, getInterval1dDomain } from '../domains';
import type { MosaicSpecPlaybookContext } from './types';

function findInterval1d(plot: MosaicSpecPlaybookContext['plots'][number]): number {
  return plot.plot.interactors.findIndex((i) => i.constructor?.name === 'Interval1D');
}

function intervalFor(plot: MosaicSpecPlaybookContext['plots'][number], range: [number, number]): { min: number; max: number } {
  const interactorIdNum = findInterval1d(plot);
  const domain = interactorIdNum >= 0 ? getInterval1dDomain(plot.plot, interactorIdNum) : null;
  if (!domain) return { min: range[0], max: range[1] };
  const [min, max] = domainToInterval(domain, range);
  return { min: min as number, max: max as number };
}

export function buildCrossfilterPlaybook(ctx: MosaicSpecPlaybookContext): VacpPlaybook[] {
  // Crossfilter uses three histogram plots, each with an intervalX interactor.
  const plots = ctx.plots.filter((p) => findInterval1d(p) >= 0);
  if (plots.length < 2) return [];

  const [delayPlot, timePlot, distPlot] = [plots[0]!, plots[1]!, plots[2] ?? null];
  const delayId = String(findInterval1d(delayPlot));
  const timeId = String(findInterval1d(timePlot));
  const distId = distPlot ? String(findInterval1d(distPlot)) : null;

  const delay = intervalFor(delayPlot, [0.45, 0.65]); // moderate arrival delays
  const time = intervalFor(timePlot, [0.25, 0.5]); // morning-ish
  const dist = distPlot ? intervalFor(distPlot, [0.2, 0.55]) : null; // short→mid flights

  const b = playbook({
    id: 'crossfilter-brush-chain',
    title: 'Playbook: Crossfilter (chain brushes)',
    description: 'Apply a sequence of interval brushes across histograms to cross-filter the remaining views.',
  })
    .action('Clear arrival-delay brush', { name: 'mosaic.clear_interval_1d', params: { plotId: delayPlot.plotId, interactorId: delayId } })
    .action('Clear departure-time brush', { name: 'mosaic.clear_interval_1d', params: { plotId: timePlot.plotId, interactorId: timeId } });

  if (distPlot && distId) {
    b.action('Clear distance brush', { name: 'mosaic.clear_interval_1d', params: { plotId: distPlot.plotId, interactorId: distId } });
  }

  b.action('Brush arrival delays (moderate)', { name: 'mosaic.set_interval_1d', params: { plotId: delayPlot.plotId, interactorId: delayId, min: delay.min, max: delay.max } })
    .action('Brush departure time (morning)', { name: 'mosaic.set_interval_1d', params: { plotId: timePlot.plotId, interactorId: timeId, min: time.min, max: time.max } });

  if (distPlot && distId && dist) {
    b.action('Brush distance (short→mid)', { name: 'mosaic.set_interval_1d', params: { plotId: distPlot.plotId, interactorId: distId, min: dist.min, max: dist.max } });
  }

  b.note('Done', 'The brushes remain active so the crossfilter result stays visible after “Run all”.');

  return [b.build()];
}
