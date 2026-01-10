import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import type { MosaicSpecPlaybookContext } from './types';

export function buildUsStateMapPlaybook(_ctx: MosaicSpecPlaybookContext): VacpPlaybook[] {
  // This example is primarily hover-driven tooltips; Mosaic does not expose a stable semantic action for tooltip hover here.
  return [
    playbook({
      id: 'us-state-map-tooltips',
      title: 'Playbook: U.S. States (inspect tooltips)',
      description: 'Hover over state centroids to inspect tooltips (manual interaction).',
    })
      .step('Hover a state centroid', { description: 'A tooltip should show the state name.' })
      .step('Compare a few regions', {
        description: 'Try west coast vs northeast to confirm centroids align with geometry.',
      })
      .build(),
  ];
}
