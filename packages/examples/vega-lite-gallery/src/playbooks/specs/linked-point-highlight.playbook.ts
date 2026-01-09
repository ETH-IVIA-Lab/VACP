import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import type { VegaLiteSpecPlaybookContext } from './types';

export function buildLinkedPointHighlightPlaybook(ctx: VegaLiteSpecPlaybookContext): VacpPlaybook[] {
  const baseOpacityRef = `${ctx.viewBase}/param/baseOpacity`;
  const pointSizeRef = `${ctx.viewBase}/param/pointSize`;
  const pickRef = `${ctx.viewBase}/param/pick`;

  return [
    playbook({
      id: `${ctx.entry.id}-linked-highlight`,
      title: `Playbook: ${ctx.entry.meta.title}`,
      description:
        'Answer: “Does a click highlight propagate across views?” by selecting a group and watching both the scatter + bar chart update together.',
    })
      .action('Clear selection (clean slate)', { name: 'vega_lite.clear_selection', params: { ref: pickRef } })
      .action('Dim context (opacity slider)', { name: 'vega_lite.set_param', params: { ref: baseOpacityRef, value: 0.15 } })
      .action('Select group B (click a point)', { name: 'vega_lite.set_selection', params: { ref: pickRef, value: { group: 'B' } } })
      .action('Increase point size (size slider)', { name: 'vega_lite.set_param', params: { ref: pointSizeRef, value: 700 } })
      .action('Select group C (compare)', { name: 'vega_lite.set_selection', params: { ref: pickRef, value: { group: 'C' } } })
      .action('Clear selection (reset)', { name: 'vega_lite.clear_selection', params: { ref: pickRef } })
      .action('Reset size slider (default)', { name: 'vega_lite.set_param', params: { ref: pointSizeRef, value: 80 } })
      .action('Reset opacity slider (default)', { name: 'vega_lite.set_param', params: { ref: baseOpacityRef, value: 0.25 } })
      .build(),
  ];
}

