import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import type { GalleryEntry } from './gallery';

export function buildPlaybooks(entry: GalleryEntry): VacpPlaybook[] {
  const base = `vacp://vacp-examples/vega-lite/${entry.id}/${entry.id}`;
  const isOpacity = entry.id === 'bars-point-select' || entry.id === 'linked-point-highlight';

  const pb = playbook({
    id: `${entry.id}-params`,
    title: 'Params and selection',
    description:
      'Steps through programmatic parameter updates (agent-like) and shows how they appear in state/history.',
  });

  const built = isOpacity
    ? pb
        .action('Set baseOpacity (low)', {
          name: 'vega_lite.set_param',
          params: { ref: `${base}/param/baseOpacity`, value: 0.2 },
        })
        .action('Set baseOpacity (high)', {
          name: 'vega_lite.set_param',
          params: { ref: `${base}/param/baseOpacity`, value: 0.8 },
        })
        .action(
          'Apply state via vacp.apply_state (baseOpacity)',
          {
            name: 'vacp.apply_state',
            params: {
              state: { [`${base}/param/baseOpacity`]: { kind: 'Param', name: 'baseOpacity', value: 0.35 } },
            },
          },
          { description: 'Uses the standard `vacp.apply_state` action.' },
        )
        .action(
          'Clear selection',
          { name: 'vega_lite.clear_selection', params: { ref: `${base}/param/pick` } },
          { description: 'If you selected a bar manually, this clears it.' },
        )
    : pb
        .action('Set pointSize (small)', {
          name: 'vega_lite.set_param',
          params: { ref: `${base}/param/pointSize`, value: 12 },
        })
        .action('Set pointSize (large)', {
          name: 'vega_lite.set_param',
          params: { ref: `${base}/param/pointSize`, value: 90 },
        })
        .action('Apply state via vacp.apply_state (pointSize)', {
          name: 'vacp.apply_state',
          params: { state: { [`${base}/param/pointSize`]: { kind: 'Param', name: 'pointSize', value: 36 } } },
        })
        .action(
          'Clear brush selection',
          { name: 'vega_lite.clear_selection', params: { ref: `${base}/param/brush` } },
          { description: 'If you brushed manually, this clears it.' },
        );

  return [built.build()];
}
