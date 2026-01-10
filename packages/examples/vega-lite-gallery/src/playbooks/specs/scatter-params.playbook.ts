import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import { brushAround, CLUSTER_CENTERS } from '../domains';
import type { VegaLiteSpecPlaybookContext } from './types';

export function buildScatterParamsPlaybook(ctx: VegaLiteSpecPlaybookContext): VacpPlaybook[] {
  const pointSizeRef = `${ctx.viewBase}/param/pointSize`;
  const brushRef = `${ctx.viewBase}/param/brush`;

  const a = brushAround(CLUSTER_CENTERS.bottomLeft);
  const b = brushAround(CLUSTER_CENTERS.topRight);

  return [
    playbook({
      id: `${ctx.entry.id}-brush-and-size`,
      title: `Playbook: ${ctx.entry.meta.title}`,
      description:
        'Answer: “How does brushing interact with encoding?” by brushing two clusters and using the size slider to make the selection easier to see.',
    })
      .action('Clear brush (clean slate)', { name: 'vega_lite.clear_selection', params: { ref: brushRef } })
      .action('Increase point size (size slider)', {
        name: 'vega_lite.set_param',
        params: { ref: pointSizeRef, value: 240 },
      })
      .action('Brush a cluster (bottom-left)', { name: 'vega_lite.set_selection', params: { ref: brushRef, value: a } })
      .action('Reset size slider (default)', { name: 'vega_lite.set_param', params: { ref: pointSizeRef, value: 36 } })
      .action('Move brush to a different cluster (top-right)', {
        name: 'vega_lite.set_selection',
        params: { ref: brushRef, value: b },
      })
      .build(),
  ];
}
