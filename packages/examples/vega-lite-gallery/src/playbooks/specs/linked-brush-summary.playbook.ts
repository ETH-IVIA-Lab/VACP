import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import { brushAround, CLUSTER_CENTERS } from '../domains';
import type { VegaLiteSpecPlaybookContext } from './types';

export function buildLinkedBrushSummaryPlaybook(ctx: VegaLiteSpecPlaybookContext): VacpPlaybook[] {
  const brushRef = `${ctx.viewBase}/param/brush`;
  const originRef = `${ctx.viewBase}/param/originPick`;

  const a = brushAround(CLUSTER_CENTERS.compact);
  const b = brushAround(CLUSTER_CENTERS.mid);

  return [
    playbook({
      id: `${ctx.entry.id}-overview-to-summary`,
      title: `Playbook: ${ctx.entry.meta.title}`,
      description:
        'Answer: “How does brushing change the origin counts?” by brushing clusters and watching the bar chart recompute; then pin an origin via bar clicks.',
    })
      .action('Clear brush (clean slate)', { name: 'vega_lite.clear_selection', params: { ref: brushRef } })
      .action('Clear origin pins (clean slate)', { name: 'vega_lite.clear_selection', params: { ref: originRef } })
      .action('Brush a cluster (compact)', { name: 'vega_lite.set_selection', params: { ref: brushRef, value: a } })
      .action('Pin origins (US + EU)', {
        name: 'vega_lite.set_selection',
        params: { ref: originRef, value: [{ origin: 'US' }, { origin: 'EU' }] },
      })
      .action('Move brush (mid)', {
        name: 'vega_lite.set_selection',
        params: { ref: brushRef, value: b },
      })
      .build(),
  ];
}
