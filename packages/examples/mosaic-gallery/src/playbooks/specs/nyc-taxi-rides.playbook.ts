import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import { domainToInterval, getInterval1dDomain, getInterval2dDomains } from '../domains';
import type { MosaicSpecPlaybookContext } from './types';

function findInterval2dIdx(plot: MosaicSpecPlaybookContext['plots'][number]): number {
  return plot.plot.interactors.findIndex((i) => i.constructor?.name === 'Interval2D');
}

function findInterval1dIdx(plot: MosaicSpecPlaybookContext['plots'][number]): number {
  return plot.plot.interactors.findIndex((i) => i.constructor?.name === 'Interval1D');
}

export function buildNycTaxiRidesPlaybook(ctx: MosaicSpecPlaybookContext): VacpPlaybook[] {
  // Two map-like plots (Interval2D) + one time histogram (Interval1D).
  const interval2d = ctx.plots.map((p) => ({ p, id: findInterval2dIdx(p) })).filter((x) => x.id >= 0);
  const interval1d = ctx.plots.map((p) => ({ p, id: findInterval1dIdx(p) })).filter((x) => x.id >= 0);
  if (interval2d.length < 2 || interval1d.length < 1) {
    return [
      playbook({
        id: 'nyc-taxi-rides-crossfilter',
        title: 'Playbook: NYC Taxi Rides (linked regions)',
        description: 'Brush pickup/dropoff regions and a time window to cross-filter (manual interaction).',
      })
        .step('Wait for the dataset to finish loading', { description: 'This example streams and projects spatial data; it may take a few seconds.' })
        .step('Brush a pickup region', { description: 'The dropoff density plot should update.' })
        .step('Brush a time window', { description: 'Both plots should update to the selected hours.' })
        .build(),
    ];
  }

  const pickup = interval2d[0]!.p;
  const dropoff = interval2d[1]!.p;
  const timePlot = interval1d[0]!.p;
  const pickId = interval2d[0]!.id;
  const dropId = interval2d[1]!.id;
  const timeId = interval1d[0]!.id;

  const pickDom = getInterval2dDomains(pickup.plot, pickId);
  const dropDom = getInterval2dDomains(dropoff.plot, dropId);
  const timeDom = getInterval1dDomain(timePlot.plot, timeId);

  const pickX = pickDom ? domainToInterval(pickDom.x, [0.35, 0.55]) : ([0, 1] as const);
  const pickY = pickDom ? domainToInterval(pickDom.y, [0.35, 0.55]) : ([0, 1] as const);
  const dropX = dropDom ? domainToInterval(dropDom.x, [0.45, 0.65]) : ([0, 1] as const);
  const dropY = dropDom ? domainToInterval(dropDom.y, [0.45, 0.65]) : ([0, 1] as const);
  const time = timeDom ? domainToInterval(timeDom, [0.55, 0.8]) : ([18, 23] as const);

  return [
    playbook({
      id: 'nyc-taxi-rides-crossfilter',
      title: 'Playbook: NYC Taxi Rides (linked regions)',
      description: 'Filter pickups and dropoffs by brushing a region and a time window (crossfilter selection).',
    })
      .action('Clear pickup region', { name: 'mosaic.clear_interval_2d', params: { plotId: pickup.plotId, interactorId: String(pickId) } })
      .action('Clear dropoff region', { name: 'mosaic.clear_interval_2d', params: { plotId: dropoff.plotId, interactorId: String(dropId) } })
      .action('Clear time window', { name: 'mosaic.clear_interval_1d', params: { plotId: timePlot.plotId, interactorId: String(timeId) } })
      .action('Select evening pickup hours', {
        name: 'mosaic.set_interval_1d',
        params: { plotId: timePlot.plotId, interactorId: String(timeId), min: time[0], max: time[1] },
      })
      .action('Brush a pickup hotspot region', {
        name: 'mosaic.set_interval_2d',
        params: { plotId: pickup.plotId, interactorId: String(pickId), x0: pickX[0], x1: pickX[1], y0: pickY[0], y1: pickY[1] },
      })
      .action('Brush a dropoff hotspot region', {
        name: 'mosaic.set_interval_2d',
        params: { plotId: dropoff.plotId, interactorId: String(dropId), x0: dropX[0], x1: dropX[1], y0: dropY[0], y1: dropY[1] },
      })
      .build(),
  ];
}
