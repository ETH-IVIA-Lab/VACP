import type { VacpDemo } from '@vacp/core';

import type { GalleryEntry } from './gallery';

export function buildDemos(entry: GalleryEntry): VacpDemo[] {
  const base = `vacp://vacp-examples/vega-lite/${entry.id}/${entry.id}`;
  const steps: VacpDemo['steps'] =
    entry.id === 'bars-point-select' || entry.id === 'linked-point-highlight'
      ? [
          {
            title: 'Set baseOpacity (low)',
            call: { name: 'vega_lite.set_param', params: { ref: `${base}/param/baseOpacity`, value: 0.2 } },
          },
          {
            title: 'Set baseOpacity (high)',
            call: { name: 'vega_lite.set_param', params: { ref: `${base}/param/baseOpacity`, value: 0.8 } },
          },
          {
            title: 'Apply state via debug override (baseOpacity)',
            description: 'Uses the standard `vacp.apply_state` action.',
            call: {
              name: 'vacp.apply_state',
              params: { state: { [`${base}/param/baseOpacity`]: { kind: 'Param', name: 'baseOpacity', value: 0.35 } } },
            },
          },
          {
            title: 'Clear selection',
            description: 'If you selected a bar manually, this clears it.',
            call: { name: 'vega_lite.clear_selection', params: { ref: `${base}/param/pick` } },
          },
        ]
      : [
          {
            title: 'Set pointSize (small)',
            call: { name: 'vega_lite.set_param', params: { ref: `${base}/param/pointSize`, value: 12 } },
          },
          {
            title: 'Set pointSize (large)',
            call: { name: 'vega_lite.set_param', params: { ref: `${base}/param/pointSize`, value: 90 } },
          },
          {
            title: 'Apply state via debug override (pointSize)',
            call: {
              name: 'vacp.apply_state',
              params: { state: { [`${base}/param/pointSize`]: { kind: 'Param', name: 'pointSize', value: 36 } } },
            },
          },
          {
            title: 'Clear brush selection',
            description: 'If you brushed manually, this clears it.',
            call: { name: 'vega_lite.clear_selection', params: { ref: `${base}/param/brush` } },
          },
        ];

  return [
    {
      id: `${entry.id}-params`,
      title: 'Params and selection',
      description:
        'Steps through programmatic parameter updates (agent-like) and shows how they appear in state/history.',
      steps,
    },
  ];
}
