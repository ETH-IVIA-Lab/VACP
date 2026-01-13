import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import { brushAround, CLUSTER_CENTERS } from '../domains';
import type { VegaLiteSpecPlaybookContext } from './types';

export function buildLinkedBrushDetailPlaybook(ctx: VegaLiteSpecPlaybookContext): VacpPlaybook[] {
  const brushRef = `${ctx.viewBase}/param/brush`;

  const a = brushAround(CLUSTER_CENTERS.economy);
  const b = brushAround(CLUSTER_CENTERS.muscle);

  return [
    playbook({
      id: `${ctx.entry.id}-overview-to-detail`,
      title: `Playbook: ${ctx.entry.meta.title}`,
      description:
        'Answer: “Does the detail view show only brushed points?” by brushing two regions and watching the right-hand plot update.',
    })
      .action('Clear brush (clean slate)', { name: 'vega_lite.clear_selection', params: { ref: brushRef } })
      .action('Brush a region (economy cluster)', {
        name: 'vega_lite.set_selection',
        params: { ref: brushRef, value: a },
      })
      .action('Move brush (different cluster)', {
        name: 'vega_lite.set_selection',
        params: { ref: brushRef, value: b },
      })
      .build(),
  ];
}
