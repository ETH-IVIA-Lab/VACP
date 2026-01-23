import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import type { VegaLiteSpecPlaybookContext } from '../types';

export function buildAirportsPlaybooks(ctx: VegaLiteSpecPlaybookContext): VacpPlaybook[] {
  const orgRef = `${ctx.viewBase}/param/org`;

  return [
    playbook({
      id: `${ctx.entry.id}-nd-airport-most-outgoing-to-msp`,
      title: 'Playbook: Airports (ND origin with most outgoing; top destination)',
      description:
        'Select the ND airport with the most outgoing connections (FAR: Hector International) and inspect which destination has the most flights (MSP).',
    })
      .action('Clear origin selection (clean slate)', { name: 'vega_lite.clear_selection', params: { ref: orgRef } })
      .action('Clear hover focus (clean slate)', { name: 'vega_lite.hover_tooltip', params: { clear: true } })
      .action('Click/select: FAR (Hector International, ND)', {
        name: 'vega_lite.set_selection',
        params: { ref: orgRef, value: { origin: 'FAR' } },
      })
      .action('Hover a route: FAR → MSP', {
        name: 'vega_lite.hover_tooltip',
        params: { fields: { origin: 'FAR', destination: 'MSP' } },
      })
      .build(),

    playbook({
      id: `${ctx.entry.id}-bangor-to-denver-no`,
      title: 'Playbook: Airports (Bangor → Denver?)',
      description:
        'Select Bangor International (BGR, ME) and check whether a route to Denver Intl (DEN, CO) exists (expected: no).',
    })
      .action('Clear origin selection (clean slate)', { name: 'vega_lite.clear_selection', params: { ref: orgRef } })
      .action('Clear hover focus (clean slate)', { name: 'vega_lite.hover_tooltip', params: { clear: true } })
      .action('Click/select: BGR (Bangor International, ME)', {
        name: 'vega_lite.set_selection',
        params: { ref: orgRef, value: { origin: 'BGR' } },
      })
      .build(),

    playbook({
      id: `${ctx.entry.id}-nm-airports-smallest-outgoing-flights`,
      title: 'Playbook: Airports (NM airports + smallest outgoing flights)',
      description:
        'Locate airports in New Mexico and select the smaller one to inspect its outgoing flights (expected: ROW has 961 outgoing flights).',
    })
      .action('Clear origin selection (clean slate)', { name: 'vega_lite.clear_selection', params: { ref: orgRef } })
      .action('Clear hover focus (clean slate)', { name: 'vega_lite.hover_tooltip', params: { clear: true } })
      .action('Hover: ABQ (Albuquerque, NM)', { name: 'vega_lite.hover_tooltip', params: { fields: { origin: 'ABQ' } } })
      .action('Hover: ROW (Roswell, NM)', { name: 'vega_lite.hover_tooltip', params: { fields: { origin: 'ROW' } } })
      .action('Click/select: ROW (Roswell, NM)', {
        name: 'vega_lite.set_selection',
        params: { ref: orgRef, value: { origin: 'ROW' } },
      })
      .build(),
  ];
}
