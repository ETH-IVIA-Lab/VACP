import type { VegaLiteSpecLike } from '@vacp/vega-lite';

import { makeClusteredPoints } from '../spec-data';

export const meta = {
  id: 'linked-brush-summary',
  title: 'Linked views: brush → summary',
  description:
    'An interval brush in the scatterplot filters the summary bar chart. This is the classic “overview + detail” pattern.',
};

export function createSpec(): VegaLiteSpecLike {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { values: makeClusteredPoints({ n: 640, groups: ['A', 'B', 'C', 'D'] }) },
    params: [
      {
        name: 'pointSize',
        value: 24,
        bind: { input: 'range', min: 10, max: 900, step: 10 },
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
        width: 440,
        height: 320,
      },
      {
        transform: [{ filter: { param: 'brush' } }],
        mark: { type: 'bar' },
        encoding: {
          y: { field: 'group', type: 'nominal', title: null },
          x: { aggregate: 'count', type: 'quantitative', title: 'Count (brushed)' },
          color: { field: 'group', type: 'nominal', legend: null },
        },
        width: 300,
        height: 320,
        title: 'Summary of brushed points',
      },
    ],
  };
}
