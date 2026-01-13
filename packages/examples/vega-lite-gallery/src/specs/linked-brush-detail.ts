import type { VegaLiteSpecLike } from '@vacp/vega-lite';

import { makeCarLikeData } from '../spec-data';

export const meta = {
  id: 'linked-brush-detail',
  title: 'Cars: brush → detail view',
  description:
    'Drag a brush in the left chart; the right chart shows the brushed subset in a different projection (weight vs MPG).',
};

export function createSpec(): VegaLiteSpecLike {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { values: makeCarLikeData({ n: 520 }) },
    params: [
      {
        name: 'pointSize',
        value: 36,
        bind: { input: 'range', min: 10, max: 1200, step: 10 },
      },
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
          size: { expr: 'pointSize * datum.size' },
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
        width: 480,
        height: 340,
      },
      {
        transform: [{ filter: { param: 'brush' } }],
        mark: { type: 'point', filled: true },
        encoding: {
          x: { field: 'weight', type: 'quantitative', title: 'Weight (lb)' },
          y: { field: 'mpg', type: 'quantitative', title: 'MPG' },
          size: { expr: 'pointSize * datum.size' },
          color: { field: 'origin', type: 'nominal' },
          opacity: { value: 0.9 },
          tooltip: [
            { field: 'origin', type: 'nominal', title: 'Origin' },
            { field: 'weight', type: 'quantitative', title: 'Weight (lb)' },
            { field: 'mpg', type: 'quantitative', title: 'MPG' },
            { field: 'horsepower', type: 'quantitative', title: 'HP' },
            { field: 'year', type: 'quantitative', title: 'Year' },
          ],
        },
        width: 360,
        height: 340,
        title: 'Brushed subset (detail)',
      },
    ],
  };
}
