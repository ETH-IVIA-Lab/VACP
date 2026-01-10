import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import type { MosaicSpecPlaybookContext } from './types';

export function buildWnbaShotsPlaybook(ctx: MosaicSpecPlaybookContext): VacpPlaybook[] {
  return [
    playbook({
      id: 'wnba-shots-filtering',
      title: 'Playbook: WNBA Shot Chart (filter by team/athlete)',
      description: 'Use the menu inputs to filter the shot chart by team and athlete, then leave a filter applied.',
    })
      .action('Clear team filter', { name: 'mosaic.clear_input', params: { ref: `${ctx.viewBase}/input/0` } })
      .action('Clear athlete filter', { name: 'mosaic.clear_input', params: { ref: `${ctx.viewBase}/input/1` } })
      .action('Pick a team (first non-default option)', { name: 'mosaic.set_input_option_index', params: { ref: `${ctx.viewBase}/input/0`, index: 1 } })
      .action('Pick an athlete (first option under current team)', { name: 'mosaic.set_input_option_index', params: { ref: `${ctx.viewBase}/input/1`, index: 1 } })
      .action('Clear athlete filter (compare team aggregate)', { name: 'mosaic.clear_input', params: { ref: `${ctx.viewBase}/input/1` } })
      .build(),
  ];
}
