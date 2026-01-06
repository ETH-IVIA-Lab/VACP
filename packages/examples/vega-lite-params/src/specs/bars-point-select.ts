import type { VegaLiteSpecLike } from '@vacp/vega-lite';

type Datum = { category: string; value: number };

function makeData(): Datum[] {
  return ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((category) => ({
    category,
    value: Math.round(10 + Math.random() * 90),
  }));
}

export const meta = {
  id: 'bars-point-select',
  title: 'Bars + point selection',
  description: 'A point selection highlights a category; this is a common “click-to-select” interaction.',
};

export function createSpec(): VegaLiteSpecLike {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { values: makeData() },
    params: [
      {
        name: 'pick',
        select: { type: 'point', encodings: ['x'] },
      },
    ],
    mark: { type: 'bar', cornerRadiusTopLeft: 4, cornerRadiusTopRight: 4 },
    encoding: {
      x: { field: 'category', type: 'nominal', axis: { labelAngle: 0 } },
      y: { field: 'value', type: 'quantitative' },
      color: { condition: { param: 'pick', value: '#2563eb' }, value: '#cbd5e1' },
      opacity: { condition: { param: 'pick', value: 1 }, value: 0.85 },
    },
    width: 520,
    height: 260,
  };
}
