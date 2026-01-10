import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import { domainToInterval, getInterval1dDomain } from '../domains';
import type { MosaicSpecPlaybookContext } from './types';

function markTypes(plot: MosaicSpecPlaybookContext['plots'][number]['plot']): string[] {
  return (plot.marks ?? []).map((m) => String(m?.type ?? '')).filter(Boolean);
}

function findInterval1dIdx(plot: MosaicSpecPlaybookContext['plots'][number]): number {
  return plot.plot.interactors.findIndex((i) => i.constructor?.name === 'Interval1D');
}

function intervalRange(
  plot: MosaicSpecPlaybookContext['plots'][number],
  range: [number, number],
): { min: number; max: number } {
  const idx = findInterval1dIdx(plot);
  const domain = idx >= 0 ? getInterval1dDomain(plot.plot, idx) : null;
  if (!domain) return { min: 0, max: 1 };
  const [min, max] = domainToInterval(domain, range);
  return { min: min as number, max: max as number };
}

export function buildFlightsHexbinPlaybook(ctx: MosaicSpecPlaybookContext): VacpPlaybook[] {
  const timePlot = ctx.plots.find((p) => markTypes(p.plot).includes('rectY')) ?? null;
  const delayPlot = ctx.plots.find((p) => markTypes(p.plot).includes('rectX')) ?? null;
  if (!timePlot || !delayPlot) return [];
  const timeIdx = findInterval1dIdx(timePlot);
  const delayIdx = findInterval1dIdx(delayPlot);
  if (timeIdx < 0 || delayIdx < 0) return [];

  const time = intervalRange(timePlot, [0.25, 0.5]); // morning-ish
  const delay = intervalRange(delayPlot, [0.45, 0.7]); // moderate delays

  return [
    playbook({
      id: 'flights-hexbin-filter-density',
      title: 'Playbook: Flights Hexbin (filter density)',
      description: 'Filter the hexbin density plot by brushing the marginal histograms and switching the color scale.',
    })
      .action('Clear time brush', {
        name: 'mosaic.clear_interval_1d',
        params: { plotId: timePlot.plotId, interactorId: String(timeIdx) },
      })
      .action('Clear delay brush', {
        name: 'mosaic.clear_interval_1d',
        params: { plotId: delayPlot.plotId, interactorId: String(delayIdx) },
      })
      .action('Brush departure time (morning)', {
        name: 'mosaic.set_interval_1d',
        params: { plotId: timePlot.plotId, interactorId: String(timeIdx), min: time.min, max: time.max },
      })
      .action('Brush arrival delay (moderate)', {
        name: 'mosaic.set_interval_1d',
        params: { plotId: delayPlot.plotId, interactorId: String(delayIdx), min: delay.min, max: delay.max },
      })
      .action('Set color scale: linear', {
        name: 'mosaic.set_input_option_index',
        params: { ref: `${ctx.viewBase}/input/0`, index: 1 },
      })
      .action('Set color scale: sqrt', {
        name: 'mosaic.set_input_option_index',
        params: { ref: `${ctx.viewBase}/input/0`, index: 2 },
      })
      .build(),
  ];
}
