import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import type { VegaLiteSpecPlaybookContext } from '../types';

export function buildGlobalDevelopmentPlaybooks(ctx: VegaLiteSpecPlaybookContext): VacpPlaybook[] {
  const yearRef = `${ctx.viewBase}/param/current_year`;
  const viewRef = `${ctx.viewBase}/param/view`;

  return [
    playbook({
      id: `${ctx.entry.id}-life-expectancy-max-2000`,
      title: 'Playbook: Global Development (max life expectancy in 2000)',
      description: 'Set the year to 2000 and locate the top life expectancy country (expected: Japan).',
    })
      .action('Reset pan/zoom selection (clean slate)', { name: 'vega_lite.clear_selection', params: { ref: viewRef } })
      .action('Set year = 2000', { name: 'vega_lite.set_param', params: { ref: yearRef, value: 2000 } })
      .action('Clear hover focus (clean slate)', { name: 'vega_lite.hover_tooltip', params: { clear: true } })
      .action('Hover: Japan', { name: 'vega_lite.hover_tooltip', params: { fields: { country: 'Japan' } } })
      .build(),

    playbook({
      id: `${ctx.entry.id}-fertility-1p5-2-2000`,
      title: 'Playbook: Global Development (fertility 1.5-2.0 in 2000)',
      description: 'Zoom into fertility 1.5-2.0 and inspect the countries in that band (year 2000).',
    })
      .action('Reset pan/zoom selection (clean slate)', { name: 'vega_lite.clear_selection', params: { ref: viewRef } })
      .action('Set year = 2000', { name: 'vega_lite.set_param', params: { ref: yearRef, value: 2000 } })
      .action('Zoom x to fertility 1.5-2.0 (pan/zoom via bind=scales)', {
        name: 'vega_lite.set_selection',
        params: { ref: viewRef, value: { x: [1.5, 2.0], y: [20, 90] } },
      })
      // Exhaustive hover list (keeps the “task → interaction” mapping explicit).
      .action('Hover: Australia', { name: 'vega_lite.hover_tooltip', params: { fields: { country: 'Australia' } } })
      .action('Hover: Barbados', { name: 'vega_lite.hover_tooltip', params: { fields: { country: 'Barbados' } } })
      .action('Hover: Belgium', { name: 'vega_lite.hover_tooltip', params: { fields: { country: 'Belgium' } } })
      .action('Hover: Chile', { name: 'vega_lite.hover_tooltip', params: { fields: { country: 'Chile' } } })
      .action('Hover: China', { name: 'vega_lite.hover_tooltip', params: { fields: { country: 'China' } } })
      .action('Hover: Cuba', { name: 'vega_lite.hover_tooltip', params: { fields: { country: 'Cuba' } } })
      .action('Hover: Finland', { name: 'vega_lite.hover_tooltip', params: { fields: { country: 'Finland' } } })
      .action('Hover: France', { name: 'vega_lite.hover_tooltip', params: { fields: { country: 'France' } } })
      .action('Hover: Georgia', { name: 'vega_lite.hover_tooltip', params: { fields: { country: 'Georgia' } } })
      .action('Hover: Ireland', { name: 'vega_lite.hover_tooltip', params: { fields: { country: 'Ireland' } } })
      .action('Hover: Netherlands', { name: 'vega_lite.hover_tooltip', params: { fields: { country: 'Netherlands' } } })
      .action('Hover: New Zealand', { name: 'vega_lite.hover_tooltip', params: { fields: { country: 'New Zealand' } } })
      .action('Hover: North Korea', { name: 'vega_lite.hover_tooltip', params: { fields: { country: 'North Korea' } } })
      .action('Hover: Norway', { name: 'vega_lite.hover_tooltip', params: { fields: { country: 'Norway' } } })
      .action('Hover: Portugal', { name: 'vega_lite.hover_tooltip', params: { fields: { country: 'Portugal' } } })
      .action('Hover: United Kingdom', {
        name: 'vega_lite.hover_tooltip',
        params: { fields: { country: 'United Kingdom' } },
      })
      .build(),

    playbook({
      id: `${ctx.entry.id}-largest-top10-min-lifeexp-2000`,
      title: 'Playbook: Global Development (lowest life expectancy among top-10 population, 2000)',
      description:
        'Set the year to 2000 and inspect the “largest countries” (by population) to find the lowest life expectancy among the top-10.',
    })
      .action('Reset pan/zoom selection (clean slate)', { name: 'vega_lite.clear_selection', params: { ref: viewRef } })
      .action('Set year = 2000', { name: 'vega_lite.set_param', params: { ref: yearRef, value: 2000 } })
      .action('Clear hover focus (clean slate)', { name: 'vega_lite.hover_tooltip', params: { clear: true } })
      .action('Hover: Nigeria', { name: 'vega_lite.hover_tooltip', params: { fields: { country: 'Nigeria' } } })
      .build(),
  ];
}
