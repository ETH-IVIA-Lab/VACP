import type { VegaLiteSpecLike } from '@vacp/vega-lite';

import { makeClusteredPoints } from '../spec-data';

export const meta = {
  id: 'linked-brush-detail',
  title: 'Linked views: brush → detail',
  description:
    'An interval brush in the left plot drives a filtered “detail” view in the right plot (same dataset, different view).',
};

export function createSpec(): VegaLiteSpecLike {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { values: makeClusteredPoints({ n: 560, groups: ['A', 'B', 'C'] }) },
    params: [
      {
        name: 'pointSize',
        value: 36,
        bind: { input: 'range', min: 10, max: 1200, step: 10 },
      },
      {
        name: 'brush',
        select: { type: 'interval', encodings: ['x', 'y'] },
      },
    ],
    hconcat: [
      {
        mark: { type: 'point', filled: true },
        encoding: {
          x: { field: 'x', type: 'quantitative' },
          y: { field: 'y', type: 'quantitative' },
          size: { expr: 'pointSize * datum.size' },
          color: { condition: { param: 'brush', field: 'group', type: 'nominal' }, value: '#cbd5e1' },
          opacity: { condition: { param: 'brush', value: 0.9 }, value: 0.25 },
        },
        width: 380,
        height: 300,
      },
      {
        transform: [{ filter: { param: 'brush' } }],
        mark: { type: 'point', filled: true },
        encoding: {
          x: { field: 'x', type: 'quantitative' },
          y: { field: 'y', type: 'quantitative' },
          size: { expr: 'pointSize * datum.size' },
          color: { field: 'group', type: 'nominal' },
          opacity: { value: 0.9 },
        },
        width: 380,
        height: 300,
        title: 'Brushed points (detail)',
      },
    ],
  };
}
