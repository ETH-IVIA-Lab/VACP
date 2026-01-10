import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import type { MosaicSpecPlaybookContext } from './types';

function findNearest(plot: MosaicSpecPlaybookContext['plots'][number]): number {
  return plot.plot.interactors.findIndex((i) => i.constructor?.name === 'Nearest');
}

export function buildNormalizeStocksPlaybook(ctx: MosaicSpecPlaybookContext): VacpPlaybook[] {
  const plot = ctx.plots[0];
  if (!plot) return [];
  const nearestIdx = findNearest(plot);
  if (nearestIdx < 0) {
    return [
      playbook({
        id: 'normalize-stocks-roi',
        title: 'Playbook: Normalized Stock Prices (ROI by day)',
        description: 'Hover over the chart to set a date and compare normalized returns (manual interaction).',
      })
        .step('Hover over an early date', { description: 'The vertical rule and % axis should update for that date.' })
        .step('Hover over a later date', { description: 'Compare which symbols outperform across time.' })
        .build(),
    ];
  }

  return [
    playbook({
      id: 'normalize-stocks-roi',
      title: 'Playbook: Normalized Stock Prices (ROI by day)',
      description:
        'Move the nearest/hover date to compare normalized returns across symbols and leave the hover active.',
    })
      .action('Clear hover date', {
        name: 'mosaic.clear_nearest',
        params: { plotId: plot.plotId, interactorId: String(nearestIdx) },
      })
      .action('Set hover date (example: 2013-05-13)', {
        name: 'mosaic.set_nearest',
        params: { plotId: plot.plotId, interactorId: String(nearestIdx), value: '2013-05-13' },
      })
      .action('Set hover date (example: 2013-11-29)', {
        name: 'mosaic.set_nearest',
        params: { plotId: plot.plotId, interactorId: String(nearestIdx), value: '2013-11-29' },
      })
      .build(),
  ];
}
