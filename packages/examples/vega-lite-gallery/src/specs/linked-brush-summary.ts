import type { VegaLiteSpecLike } from '@vacp/vega-lite';

import { makeCarLikeData } from '../spec-data';

export const meta = {
  id: 'linked-brush-summary',
  title: 'Cars: click → origin summary',
  description:
    'Click one or more bars to select origins (multi-select is supported). The scatterplot highlights the selected categories — a compact “summary → highlight” pattern.',
};

export function createSpec(): VegaLiteSpecLike {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { values: makeCarLikeData({ n: 520 }) },
    params: [
      {
        name: 'originPick',
        select: {
          type: 'point',
          fields: ['origin'],
          on: "click[event.item && event.item.mark && event.item.mark.marktype === 'rect']",
          toggle: 'true',
          clear: 'dblclick',
        },
      },
    ],
    hconcat: [
      {
        mark: { type: 'point', filled: true },
        encoding: {
          x: { field: 'horsepower', type: 'quantitative', title: 'Horsepower' },
          y: { field: 'mpg', type: 'quantitative', title: 'MPG' },
          size: { value: 56 },
          color: { condition: { param: 'originPick', field: 'origin', type: 'nominal' }, value: '#cbd5e1' },
          opacity: { condition: { param: 'originPick', value: 0.9 }, value: 0.25 },
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
        mark: { type: 'bar' },
        encoding: {
          y: { field: 'origin', type: 'nominal', title: null },
          x: { aggregate: 'count', type: 'quantitative', title: 'Count' },
          color: { field: 'origin', type: 'nominal', legend: null },
          opacity: { condition: { param: 'originPick', value: 0.95 }, value: 0.25 },
          tooltip: [{ field: 'origin', type: 'nominal', title: 'Origin' }, { aggregate: 'count', title: 'Count' }],
        },
        width: 260,
        height: 360,
        title: 'Origin summary (click to select)',
      },
    ],
  };
}
