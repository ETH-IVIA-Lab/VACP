import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import type { GalleryEntry } from './gallery';

export function buildPlaybooks(entry: GalleryEntry): VacpPlaybook[] {
  const base = `vacp://vacp-examples/vega-lite/${entry.id}/${entry.id}`;
  const handleRef = `${base}/data/main`;

  const pb = playbook({
    id: `${entry.id}-params`,
    title: 'Params and selection',
    description:
      'Steps through programmatic parameter updates (agent-like) and shows how they appear in state/history.',
  });

  if (entry.id === 'bars-point-select') {
    return [
      pb
        .action('Programmatically pick category=C', {
          name: 'vega_lite.set_selection',
          params: { ref: `${base}/param/pick`, value: { category: 'C' } },
        })
        .action(
          'Count selected rows (DuckDB)',
          { name: 'vacp.data_sql', params: { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle' } },
          { description: 'Shows that selection changes affect the in-browser DuckDB selection handle.' },
        )
        .action('Programmatically pick category=F', {
          name: 'vega_lite.set_selection',
          params: { ref: `${base}/param/pick`, value: { category: 'F' } },
        })
        .action('Set baseOpacity (low)', {
          name: 'vega_lite.set_param',
          params: { ref: `${base}/param/baseOpacity`, value: 0.2 },
        })
        .action('Clear selection', { name: 'vega_lite.clear_selection', params: { ref: `${base}/param/pick` } })
        .build(),
    ];
  }

  if (entry.id === 'linked-point-highlight') {
    return [
      pb
        .action('Programmatically pick group=B', {
          name: 'vega_lite.set_selection',
          params: { ref: `${base}/param/pick`, value: { group: 'B' } },
        })
        .action(
          'Count selected rows (DuckDB)',
          { name: 'vacp.data_sql', params: { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle' } },
          { description: 'Filters DuckDB rows using the current selection signal.' },
        )
        .action('Programmatically pick group=C', {
          name: 'vega_lite.set_selection',
          params: { ref: `${base}/param/pick`, value: { group: 'C' } },
        })
        .action('Set pointSize (large)', {
          name: 'vega_lite.set_param',
          params: { ref: `${base}/param/pointSize`, value: 700 },
        })
        .action('Clear selection', { name: 'vega_lite.clear_selection', params: { ref: `${base}/param/pick` } })
        .build(),
    ];
  }

  const brushPlaybook = pb
    .action('Clear brush', { name: 'vega_lite.clear_selection', params: { ref: `${base}/param/brush` } })
    .action('Set brush over bottom-left cluster', {
      name: 'vega_lite.set_selection',
      params: { ref: `${base}/param/brush`, value: { x: [10, 40], y: [12, 45] } },
    })
    .action(
      'Count selected rows (DuckDB)',
      { name: 'vacp.data_sql', params: { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle' } },
      { description: 'Selection changes should measurably affect the data handle.' },
    )
    .action('Move brush to top-right cluster', {
      name: 'vega_lite.set_selection',
      params: { ref: `${base}/param/brush`, value: { x: [58, 92], y: [55, 90] } },
    })
    .action('Set pointSize (large)', {
      name: 'vega_lite.set_param',
      params: { ref: `${base}/param/pointSize`, value: 800 },
    })
    .action('Clear brush again', { name: 'vega_lite.clear_selection', params: { ref: `${base}/param/brush` } });

  return [brushPlaybook.build()];
}
