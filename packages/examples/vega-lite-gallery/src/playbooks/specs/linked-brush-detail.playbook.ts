import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import { brushAround, CLUSTER_CENTERS } from '../domains';
import type { VegaLiteSpecPlaybookContext } from './types';

export function buildLinkedBrushDetailPlaybook(ctx: VegaLiteSpecPlaybookContext): VacpPlaybook[] {
  const pointSizeRef = `${ctx.viewBase}/param/pointSize`;
  const brushRef = `${ctx.viewBase}/param/brush`;

  const a = brushAround(CLUSTER_CENTERS.topLeft);
  const b = brushAround(CLUSTER_CENTERS.bottomRight);

  return [
    playbook({
      id: `${ctx.entry.id}-overview-to-detail`,
      title: `Playbook: ${ctx.entry.meta.title}`,
      description:
        'Answer: “Does the detail view show only brushed points?” by brushing two regions and watching the right-hand plot update.',
    })
      .action('Clear brush (clean slate)', { name: 'vega_lite.clear_selection', params: { ref: brushRef } })
      .action('Increase point size (size slider)', { name: 'vega_lite.set_param', params: { ref: pointSizeRef, value: 240 } })
      .action('Brush a region (top-left cluster)', { name: 'vega_lite.set_selection', params: { ref: brushRef, value: a } })
      .action('Reset size slider (default)', { name: 'vega_lite.set_param', params: { ref: pointSizeRef, value: 36 } })
      .action('Move brush (bottom-right cluster)', { name: 'vega_lite.set_selection', params: { ref: brushRef, value: b } })
      .note('Done', 'The brush remains active on the bottom-right cluster so the linked detail view stays filtered after “Run all”.')
      .build(),
  ];
}
