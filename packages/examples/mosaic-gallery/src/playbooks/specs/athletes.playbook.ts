import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import { getInterval2dDomains, roundNum } from '../domains';
import type { MosaicSpecPlaybookContext } from './types';

function findInterval2d(
  ctx: MosaicSpecPlaybookContext,
): { plotId: string; interactorId: string; plotIdx: number } | null {
  const plotIdx = ctx.plots.findIndex((p) => p.plot.interactors.some((i) => i.constructor?.name === 'Interval2D'));
  if (plotIdx < 0) return null;
  const plot = ctx.plots[plotIdx]!;
  const id = plot.plot.interactors.findIndex((i) => i.constructor?.name === 'Interval2D');
  if (id < 0) return null;
  return { plotId: plot.plotId, interactorId: String(id), plotIdx };
}

export function buildAthletesPlaybook(ctx: MosaicSpecPlaybookContext): VacpPlaybook[] {
  const interval = findInterval2d(ctx);
  const domains =
    interval && typeof interval.plotIdx === 'number'
      ? getInterval2dDomains(ctx.plots[interval.plotIdx]!.plot, Number(interval.interactorId))
      : null;
  const yDomain = domains?.y ?? ([0, 1] as const);

  const clearInputs = (b: ReturnType<typeof playbook>) =>
    b
      .action('Clear Sport menu', { name: 'mosaic.clear_input', params: { ref: `${ctx.viewBase}/input/0` } })
      .action('Clear Sex menu', { name: 'mosaic.clear_input', params: { ref: `${ctx.viewBase}/input/1` } })
      .action('Clear Name search', { name: 'mosaic.clear_input', params: { ref: `${ctx.viewBase}/input/2` } });

  const clearBrush = (b: ReturnType<typeof playbook>) => {
    if (!interval) return b;
    return b.action('Clear scatter brush', {
      name: 'mosaic.clear_interval_2d',
      params: { plotId: interval.plotId, interactorId: interval.interactorId },
    });
  };

  const task1 = (() => {
    const b = playbook({
      id: 'athletes-regression-slope-football-vs-cycling',
      title: 'Playbook: Olympic Athletes (male regression slope: football vs cycling)',
      description:
        'Filter to male athletes, compare regression lines for football vs cycling, and decide which is steeper (expected: football).',
    });

    clearInputs(b);
    clearBrush(b);

    b.action('Set Sex = male', {
      name: 'mosaic.set_input_value',
      params: { ref: `${ctx.viewBase}/input/1`, value: 'male' },
    })
      .action('Set Sport = football', {
        name: 'mosaic.set_input_value',
        params: { ref: `${ctx.viewBase}/input/0`, value: 'football' },
      })
      .action('Set Sport = cycling', {
        name: 'mosaic.set_input_value',
        params: { ref: `${ctx.viewBase}/input/0`, value: 'cycling' },
      });

    return b.build();
  })();

  const task2 = (() => {
    const b = playbook({
      id: 'athletes-tallest-female-top3',
      title: 'Playbook: Olympic Athletes (top-3 tallest female athletes)',
      description: 'Filter to female athletes, sort by height (desc), and read off the first three rows.',
    });

    clearInputs(b);
    clearBrush(b);

    b.action('Set Sex = female', {
      name: 'mosaic.set_input_value',
      params: { ref: `${ctx.viewBase}/input/1`, value: 'female' },
    })
      .action('Clear table sort (clean slate)', { name: 'mosaic.table_clear_sort', params: { tableId: 'table-0' } })
      .action('Sort by height (descending)', {
        name: 'mosaic.table_set_sort',
        params: { tableId: 'table-0', column: 'height', desc: true },
      });

    return b.build();
  })();

  const task3 = (() => {
    const b = playbook({
      id: 'athletes-female-judo-100-120kg',
      title: 'Playbook: Olympic Athletes (female judo, 100-120 kg)',
      description: 'Filter to female + judo and brush weight 100-120 kg, then inspect the resulting table row count.',
    });

    clearInputs(b);
    clearBrush(b);

    b.action('Set Sex = female', {
      name: 'mosaic.set_input_value',
      params: { ref: `${ctx.viewBase}/input/1`, value: 'female' },
    }).action('Set Sport = judo', {
      name: 'mosaic.set_input_value',
      params: { ref: `${ctx.viewBase}/input/0`, value: 'judo' },
    });

    if (interval && domains?.x) {
      const lo = typeof domains.x[0] === 'number' ? domains.x[0] : 0;
      const hi = typeof domains.x[1] === 'number' ? domains.x[1] : 1;
      const x0 = roundNum(Math.max(lo, Math.min(hi, 100)));
      const x1 = roundNum(Math.max(lo, Math.min(hi, 120)));
      const y0 = typeof yDomain[0] === 'number' ? yDomain[0] : 0;
      const y1 = typeof yDomain[1] === 'number' ? yDomain[1] : 1;
      b.action('Brush weight 100-120 kg (full height range)', {
        name: 'mosaic.set_interval_2d',
        params: {
          plotId: interval.plotId,
          interactorId: interval.interactorId,
          x0,
          x1,
          y0,
          y1,
        },
      });
    } else {
      b.step('Brush weight 100-120 kg', {
        description: 'Use the scatterplot brush to select weight between 100 and 120.',
      });
    }

    return b.build();
  })();

  return [task1, task2, task3];
}
