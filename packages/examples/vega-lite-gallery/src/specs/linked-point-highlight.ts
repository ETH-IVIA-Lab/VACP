import type { VegaLiteSpecLike } from '@vacp/vega-lite';

import { makeCarLikeData } from '../spec-data';

export const meta = {
  id: 'linked-point-highlight',
  title: 'Cars: click → highlight origin',
  description:
    'Click a point to select its origin and highlight that category across the scatter and the summary bars (no filtering, just emphasis).',
};

export function createSpec(): VegaLiteSpecLike {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { values: makeCarLikeData({ n: 460 }) },
    params: [
      {
        name: 'baseOpacity',
        value: 0.25,
        bind: { input: 'range', min: 0.05, max: 0.9, step: 0.01 },
      },
      {
        name: 'pointSize',
        value: 80,
        bind: { input: 'range', min: 20, max: 1200, step: 10 },
      },
      {
        name: 'pick',
        select: { type: 'point', fields: ['origin'], on: 'click', clear: 'dblclick' },
      },
    ],
    vconcat: [
      {
        mark: { type: 'point', filled: true },
        encoding: {
          x: { field: 'horsepower', type: 'quantitative', title: 'Horsepower' },
          y: { field: 'mpg', type: 'quantitative', title: 'MPG' },
          color: { field: 'origin', type: 'nominal' },
          size: { expr: 'pointSize * datum.size' },
          opacity: { condition: { param: 'pick', value: 0.95 }, expr: 'baseOpacity' },
          tooltip: [
            { field: 'origin', type: 'nominal', title: 'Origin' },
            { field: 'horsepower', type: 'quantitative', title: 'HP' },
            { field: 'mpg', type: 'quantitative', title: 'MPG' },
            { field: 'weight', type: 'quantitative', title: 'Weight (lb)' },
            { field: 'year', type: 'quantitative', title: 'Year' },
          ],
        },
        width: 720,
        height: 300,
        title: 'Click a point (double-click to clear)',
      },
      {
        mark: { type: 'bar' },
        encoding: {
          x: { aggregate: 'count', type: 'quantitative', title: 'Count' },
          y: { field: 'origin', type: 'nominal', title: null },
          color: { field: 'origin', type: 'nominal', legend: null },
          opacity: { condition: { param: 'pick', value: 1.0 }, expr: 'baseOpacity' },
          tooltip: [{ field: 'origin', type: 'nominal', title: 'Origin' }, { aggregate: 'count', title: 'Count' }],
        },
        width: 720,
        height: 160,
        title: 'Linked highlight (same selection)',
      },
    ],
  };
}
