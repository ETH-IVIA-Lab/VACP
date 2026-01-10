import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import type { VegaLiteSpecPlaybookContext } from './types';

export function buildBarsPointSelectPlaybook(ctx: VegaLiteSpecPlaybookContext): VacpPlaybook[] {
  const baseOpacityRef = `${ctx.viewBase}/param/baseOpacity`;
  const pickRef = `${ctx.viewBase}/param/pick`;

  return [
    playbook({
      id: `${ctx.entry.id}-compare-categories`,
      title: `Playbook: ${ctx.entry.meta.title}`,
      description:
        'Answer: “How do I compare a few categories without losing context?” by selecting a bar and using the opacity slider to fade/unfade non-selected bars.',
    })
      .action('Clear bar selection (clean slate)', { name: 'vega_lite.clear_selection', params: { ref: pickRef } })
      .action('Fade non-selected bars (opacity slider)', { name: 'vega_lite.set_param', params: { ref: baseOpacityRef, value: 0.15 } })
      .action('Select category C (click a bar)', { name: 'vega_lite.set_selection', params: { ref: pickRef, value: { category: 'C' } } })
      .action('Select category F (compare)', { name: 'vega_lite.set_selection', params: { ref: pickRef, value: { category: 'F' } } })
      .action('Bring context back (opacity slider)', { name: 'vega_lite.set_param', params: { ref: baseOpacityRef, value: 0.6 } })
      .note('Done', 'Category F remains selected so the result is visible after “Run all”.')
      .build(),
  ];
}
