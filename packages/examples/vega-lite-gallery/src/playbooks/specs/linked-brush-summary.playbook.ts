import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import type { VegaLiteSpecPlaybookContext } from './types';

export function buildLinkedBrushSummaryPlaybook(ctx: VegaLiteSpecPlaybookContext): VacpPlaybook[] {
  const originRef = `${ctx.viewBase}/param/originPick`;

  return [
    playbook({
      id: `${ctx.entry.id}-overview-to-summary`,
      title: `Playbook: ${ctx.entry.meta.title}`,
      description:
        'Answer: “Which origins drive the highlight?” by selecting multiple origin bars and watching the scatterplot update.',
    })
      .action('Clear origin selection (clean slate)', { name: 'vega_lite.clear_selection', params: { ref: originRef } })
      .action('Select multiple origins (US + EU)', {
        name: 'vega_lite.set_selection',
        params: { ref: originRef, value: [{ origin: 'US' }, { origin: 'EU' }] },
      })
      .action('Switch selection (JP only)', {
        name: 'vega_lite.set_selection',
        params: { ref: originRef, value: [{ origin: 'JP' }] },
      })
      .build(),
  ];
}
