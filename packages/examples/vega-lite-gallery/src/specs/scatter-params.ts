import type { VegaLiteSpecLike } from '@vacp/vega-lite';

import { makeCarLikeData } from '../spec-data';

export const meta = {
  id: 'scatter-params',
  title: 'Cars: MPG vs horsepower (brush + size slider)',
  description:
    'Drag a rectangular brush to focus on a region; use the size slider to change the mark emphasis. VACP exposes both the slider param and the brush selection.',
};

export function createSpec(): VegaLiteSpecLike {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { values: makeCarLikeData({ n: 480 }) },
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
    mark: { type: 'point', filled: true },
    encoding: {
      x: { field: 'horsepower', type: 'quantitative', title: 'Horsepower' },
      y: { field: 'mpg', type: 'quantitative', title: 'MPG' },
      // Multiply by per-point `size` so the slider actually changes the visible marks.
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
    width: 720,
    height: 380,
  };
}
