import type { VegaLiteSpecLike } from '@vacp/vega-lite';

import { makeClusteredPoints } from '../spec-data';

export const meta = {
  id: 'scatter-params',
  title: 'Scatter + slider + interval brush',
  description: 'A slider controls point size while an interval selection drives conditional color/opacity.',
};

export function createSpec(): VegaLiteSpecLike {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { values: makeClusteredPoints({ n: 320, groups: ['A', 'B'] }) },
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
    mark: { type: 'point', filled: true },
    encoding: {
      x: { field: 'x', type: 'quantitative' },
      y: { field: 'y', type: 'quantitative' },
      // Multiply by per-point `size` so the slider actually changes the visible marks.
      size: { expr: 'pointSize * datum.size' },
      color: { condition: { param: 'brush', field: 'group', type: 'nominal' }, value: '#cbd5e1' },
      opacity: { condition: { param: 'brush', value: 0.9 }, value: 0.25 },
    },
    width: 520,
    height: 360,
  };
}
