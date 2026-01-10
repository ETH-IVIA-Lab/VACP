import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import { brushAround, CLUSTER_CENTERS } from '../domains';
import type { VegaLiteSpecPlaybookContext } from './types';

export function buildLinkedBrushSummaryPlaybook(ctx: VegaLiteSpecPlaybookContext): VacpPlaybook[] {
  const pointSizeRef = `${ctx.viewBase}/param/pointSize`;
  const brushRef = `${ctx.viewBase}/param/brush`;

  const a = brushAround(CLUSTER_CENTERS.bottomLeft);
  const b = brushAround(CLUSTER_CENTERS.topRight);

  return [
    playbook({
      id: `${ctx.entry.id}-overview-to-summary`,
      title: `Playbook: ${ctx.entry.meta.title}`,
      description:
        'Answer: “How does brushing drive a summary?” by brushing two clusters and watching the bar chart re-compute counts for the brushed subset.',
    })
      .action('Clear brush (clean slate)', { name: 'vega_lite.clear_selection', params: { ref: brushRef } })
      .action('Increase point size (size slider)', { name: 'vega_lite.set_param', params: { ref: pointSizeRef, value: 200 } })
      .action('Brush a cluster (bottom-left)', { name: 'vega_lite.set_selection', params: { ref: brushRef, value: a } })
      .action('Move brush (top-right cluster)', { name: 'vega_lite.set_selection', params: { ref: brushRef, value: b } })
      .action('Reset size slider (default)', { name: 'vega_lite.set_param', params: { ref: pointSizeRef, value: 24 } })
      .note('Done', 'The brush remains active on the top-right cluster so the summary stays filtered after “Run all”.')
      .build(),
  ];
}
