import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

export function buildVanillaMinimalPlaybooks(): VacpPlaybook[] {
  return [
    playbook({
      id: 'vanilla-minimal-selection',
      title: 'Playbook: Vanilla minimal (multi-select)',
      description:
        'Answer: “How do I build up a small multi-selection?” by toggling a couple point ids, removing one, then clearing.',
    })
      .action('Clear selection', { name: 'vanilla.clear_selection', params: {} })
      .action('Select id=1', { name: 'vanilla.toggle_point', params: { id: 1 } })
      .action('Select id=2', { name: 'vanilla.toggle_point', params: { id: 2 } })
      .action('Deselect id=1 (toggle again)', { name: 'vanilla.toggle_point', params: { id: 1 } })
      .action('Clear selection (reset)', { name: 'vanilla.clear_selection', params: {} })
      .build(),
  ];
}
