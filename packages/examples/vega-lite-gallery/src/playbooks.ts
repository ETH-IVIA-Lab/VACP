import type { VacpPlaybook, VacpRef } from '@vacp/core';
import { playbook } from '@vacp/kit';

export type VegaLitePlaybookEntry = { id: string };

export function buildVegaLitePlaybooks(entry: VegaLitePlaybookEntry): VacpPlaybook[] {
  const base = `vacp://vacp-examples/vega-lite/${entry.id}/${entry.id}`;
  const handleRef = `${base}/data/main` as VacpRef;

  const pb = playbook({
    id: `${entry.id}-params`,
    title: 'Params and selection',
    description: 'Mutate selections programmatically and validate changes with DuckDB queries.',
  });

  if (entry.id === 'bars-point-select') {
    return [
      pb
        .action('Pick category=C', { name: 'vega_lite.set_selection', params: { ref: `${base}/param/pick`, value: { category: 'C' } } })
        .action('Count selected rows (DuckDB)', { name: 'vacp.data_sql', params: { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle' } })
        .action('Pick category=F', { name: 'vega_lite.set_selection', params: { ref: `${base}/param/pick`, value: { category: 'F' } } })
        .action('Set baseOpacity (low)', { name: 'vega_lite.set_param', params: { ref: `${base}/param/baseOpacity`, value: 0.2 } })
        .action('Clear selection', { name: 'vega_lite.clear_selection', params: { ref: `${base}/param/pick` } })
        .build(),
    ];
  }

  if (entry.id === 'linked-point-highlight') {
    return [
      pb
        .action('Pick group=B', { name: 'vega_lite.set_selection', params: { ref: `${base}/param/pick`, value: { group: 'B' } } })
        .action('Count selected rows (DuckDB)', { name: 'vacp.data_sql', params: { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle' } })
        .action('Pick group=C', { name: 'vega_lite.set_selection', params: { ref: `${base}/param/pick`, value: { group: 'C' } } })
        .action('Set pointSize (large)', { name: 'vega_lite.set_param', params: { ref: `${base}/param/pointSize`, value: 700 } })
        .action('Clear selection', { name: 'vega_lite.clear_selection', params: { ref: `${base}/param/pick` } })
        .build(),
    ];
  }

  const brushPlaybook = pb
    .action('Clear brush', { name: 'vega_lite.clear_selection', params: { ref: `${base}/param/brush` } })
    .action('Brush bottom-left cluster', {
      name: 'vega_lite.set_selection',
      params: { ref: `${base}/param/brush`, value: { x: [10, 40], y: [12, 45] } },
    })
    .action('Count selected rows (DuckDB)', { name: 'vacp.data_sql', params: { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle' } })
    .action('Move brush top-right', {
      name: 'vega_lite.set_selection',
      params: { ref: `${base}/param/brush`, value: { x: [58, 92], y: [55, 90] } },
    })
    .action('Set pointSize (large)', { name: 'vega_lite.set_param', params: { ref: `${base}/param/pointSize`, value: 800 } })
    .action('Clear brush again', { name: 'vega_lite.clear_selection', params: { ref: `${base}/param/brush` } });

  return [brushPlaybook.build()];
}

