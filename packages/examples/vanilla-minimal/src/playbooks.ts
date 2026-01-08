import type { VacpPlaybook, VacpRef } from '@vacp/core';
import { playbook } from '@vacp/kit';

export function buildVanillaMinimalPlaybooks(args: { handleRef: VacpRef }): VacpPlaybook[] {
  return [
    playbook({
      id: 'vanilla-selection',
      title: 'Selection + DuckDB',
      description: 'Step through agent-style actions, then compare with clicking points by hand.',
    })
      .action('Clear selection', { name: 'vanilla.clear_selection', params: {} })
      .action('Select id=1', { name: 'vanilla.toggle_point', params: { id: 1 } })
      .action('Select id=2', { name: 'vanilla.toggle_point', params: { id: 2 } })
      .action('Count selected (DuckDB)', {
        name: 'vacp.data_sql',
        params: { handleRef: args.handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle' },
      })
      .build(),
  ];
}

