import type { VegaLiteSpecLike } from '@vacp/vega-lite';

type Datum = { x: number; y: number; group: string };

function makeData(n = 500): Datum[] {
  const out: Datum[] = [];
  for (let i = 0; i < n; i++) {
    const group = i % 3 === 0 ? 'A' : i % 3 === 1 ? 'B' : 'C';
    out.push({ x: Math.random() * 100, y: Math.random() * 100, group });
  }
  return out;
}

export const meta = {
  id: 'linked-brush-detail',
  title: 'Linked views: brush → detail',
  description:
    'An interval brush in the left plot drives a filtered “detail” view in the right plot (same dataset, different view).',
};

export function createSpec(): VegaLiteSpecLike {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { values: makeData() },
    params: [
      {
        name: 'pointSize',
        value: 36,
        bind: { input: 'range', min: 6, max: 200, step: 1 },
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
          size: { expr: 'pointSize' },
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
          size: { expr: 'pointSize' },
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
