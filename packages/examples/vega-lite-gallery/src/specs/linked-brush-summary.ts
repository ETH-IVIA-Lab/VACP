import type { VegaLiteSpecLike } from '@vacp/vega-lite';

import { makeCarLikeData } from '../spec-data';

export const meta = {
  id: 'linked-brush-summary',
  title: 'Cars: brush → origin summary',
  description:
    'Drag a brush in the scatterplot; the bar chart recomputes counts for the brushed subset (grouped by origin). This is a realistic “overview → summary” pattern.',
};

export function createSpec(): VegaLiteSpecLike {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { values: makeCarLikeData({ n: 520 }) },
    params: [
      {
        name: 'brush',
        select: { type: 'interval', encodings: ['x', 'y'], clear: 'dblclick' },
      },
    ],
    hconcat: [
      {
        mark: { type: 'point', filled: true },
        encoding: {
          x: { field: 'horsepower', type: 'quantitative', title: 'Horsepower' },
          y: { field: 'mpg', type: 'quantitative', title: 'MPG' },
          size: { value: 56 },
          color: { condition: { param: 'brush', field: 'origin', type: 'nominal' }, value: '#cbd5e1' },
          opacity: { condition: { param: 'brush', value: 0.9 }, value: 0.25 },
          tooltip: [
            { field: 'origin', type: 'nominal', title: 'Origin' },
            { field: 'horsepower', type: 'quantitative', title: 'HP' },
            { field: 'mpg', type: 'quantitative', title: 'MPG' },
            { field: 'weight', type: 'quantitative', title: 'Weight (lb)' },
            { field: 'year', type: 'quantitative', title: 'Year' },
          ],
        },
        width: 520,
        height: 360,
      },
      {
        transform: [{ filter: { param: 'brush' } }],
        mark: { type: 'bar' },
        encoding: {
          y: { field: 'origin', type: 'nominal', title: null },
          x: { aggregate: 'count', type: 'quantitative', title: 'Count (brushed)' },
          color: { field: 'origin', type: 'nominal', legend: null },
          tooltip: [{ field: 'origin', type: 'nominal', title: 'Origin' }, { aggregate: 'count', title: 'Count' }],
        },
        width: 260,
        height: 360,
        title: 'Brushed subset (by origin)',
      },
    ],
  };
}
