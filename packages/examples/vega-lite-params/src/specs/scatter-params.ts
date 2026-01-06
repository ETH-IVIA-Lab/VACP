import type { VegaLiteSpecLike } from '@vacp/vega-lite';

type Datum = { x: number; y: number; group: string };

function makeData(n = 200): Datum[] {
  const data: Datum[] = [];
  for (let i = 0; i < n; i++) {
    const group = i % 2 === 0 ? 'A' : 'B';
    data.push({
      x: Math.random() * 100,
      y: Math.random() * 100,
      group,
    });
  }
  return data;
}

export const meta = {
  id: 'scatter-params',
  title: 'Scatter + slider + interval brush',
  description: 'A slider controls point size while an interval selection drives conditional color/opacity.',
};

export function createSpec(): VegaLiteSpecLike {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { values: makeData() },
    params: [
      {
        name: 'pointSize',
        value: 36,
        bind: { input: 'range', min: 4, max: 200, step: 1 },
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
      size: { expr: 'pointSize' },
      color: { condition: { param: 'brush', field: 'group', type: 'nominal' }, value: '#cbd5e1' },
      opacity: { condition: { param: 'brush', value: 0.9 }, value: 0.25 },
    },
    width: 520,
    height: 360,
  };
}
