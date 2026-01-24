import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import type { VegaLiteSpecPlaybookContext } from '../types';

function monthDate(month0: number, day: number): Date {
  // Vega-Lite `timeUnit: "monthdate"` bins `date` into a fixed reference year, which (for
  // the Seattle Weather example dataset) is 2012 in the local timezone.
  return new Date(2012, month0, day, 0, 0, 0, 0);
}

export function buildSeattleWeatherPlaybooks(ctx: VegaLiteSpecPlaybookContext): VacpPlaybook[] {
  const brushRef = `${ctx.viewBase}/param/brush`;
  const clickRef = `${ctx.viewBase}/param/click`;

  return [
    playbook({
      id: `${ctx.entry.id}-sun-vs-rain-feb-apr-vs-aug-oct`,
      title: 'Playbook: Seattle Weather (sun vs rain by season slice)',
      description: 'Brush Feb-Apr and Aug-Oct and compare bar lengths for “sun” vs “rain” in each brushed interval.',
    })
      .action('Clear point selection (clean slate)', { name: 'vega_lite.clear_selection', params: { ref: clickRef } })
      .action('Clear brush selection (clean slate)', { name: 'vega_lite.clear_selection', params: { ref: brushRef } })
      .action('Brush Feb-Apr', {
        name: 'vega_lite.set_selection',
        params: { ref: brushRef, value: { x: [monthDate(1, 1), monthDate(3, 30)] } },
      })
      .action('Brush Aug-Oct', {
        name: 'vega_lite.set_selection',
        params: { ref: brushRef, value: { x: [monthDate(7, 1), monthDate(9, 31)] } },
      })
      .build(),

    playbook({
      id: `${ctx.entry.id}-extreme-temp-max-by-weather`,
      title: 'Playbook: Seattle Weather (extreme max temp for rain/sun/snow)',
      description:
        'Filter by weather category and locate the maximum `temp_max` point via tooltip (one example per category).',
    })
      .action('Clear brush selection (clean slate)', { name: 'vega_lite.clear_selection', params: { ref: brushRef } })
      .action('Clear point selection (clean slate)', { name: 'vega_lite.clear_selection', params: { ref: clickRef } })
      .action('Clear hover focus (clean slate)', { name: 'vega_lite.hover_tooltip', params: { clear: true } })
      .action('Filter: sun', { name: 'vega_lite.set_selection', params: { ref: clickRef, value: { weather: 'sun' } } })
      .action('Hover: sun max temp (35.0°C)', {
        name: 'vega_lite.hover_tooltip',
        params: { fields: { date: new Date('2015-07-19'), temp_max: 35.0 } },
      })
      .action('Filter: rain', {
        name: 'vega_lite.set_selection',
        params: { ref: clickRef, value: { weather: 'rain' } },
      })
      .action('Hover: rain max temp (35.6°C)', {
        name: 'vega_lite.hover_tooltip',
        params: { fields: { date: new Date('2014-08-11'), temp_max: 35.6 } },
      })
      .action('Filter: snow', {
        name: 'vega_lite.set_selection',
        params: { ref: clickRef, value: { weather: 'snow' } },
      })
      .action('Hover: snow max temp (11.1°C)', {
        name: 'vega_lite.hover_tooltip',
        params: { fields: { date: new Date('2012-03-15'), temp_max: 11.1 } },
      })
      .build(),

    playbook({
      id: `${ctx.entry.id}-snow-season-temp-ranges`,
      title: 'Playbook: Seattle Weather (when snow happens + temp ranges)',
      description:
        'Filter to snow and brush different month ranges to inspect where snow occurs and its temperature range.',
    })
      .action('Clear brush selection (clean slate)', { name: 'vega_lite.clear_selection', params: { ref: brushRef } })
      .action('Filter: snow', {
        name: 'vega_lite.set_selection',
        params: { ref: clickRef, value: { weather: 'snow' } },
      })
      .action('Brush Jan-Apr', {
        name: 'vega_lite.set_selection',
        params: { ref: brushRef, value: { x: [monthDate(0, 1), monthDate(3, 30)] } },
      })
      .action('Brush Nov-Dec', {
        name: 'vega_lite.set_selection',
        params: { ref: brushRef, value: { x: [monthDate(10, 1), monthDate(11, 31)] } },
      })
      .build(),
  ];
}
