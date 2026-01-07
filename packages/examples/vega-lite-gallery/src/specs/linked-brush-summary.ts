import type { VegaLiteSpecLike } from '@vacp/vega-lite';

type Datum = { x: number; y: number; group: string };

function makeData(n = 600): Datum[] {
  const out: Datum[] = [];
  for (let i = 0; i < n; i++) {
    const group = i % 4 === 0 ? 'A' : i % 4 === 1 ? 'B' : i % 4 === 2 ? 'C' : 'D';
    out.push({ x: Math.random() * 100, y: Math.random() * 100, group });
  }
  return out;
}

export const meta = {
  id: 'linked-brush-summary',
  title: 'Linked views: brush → summary',
  description:
    'An interval brush in the scatterplot filters the summary bar chart. This is the classic “overview + detail” pattern.',
};

export function createSpec(): VegaLiteSpecLike {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { values: makeData() },
    params: [
      {
        name: 'pointSize',
        value: 24,
        bind: { input: 'range', min: 6, max: 120, step: 1 },
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
