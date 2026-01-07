import type { VegaLiteSpecLike } from '@vacp/vega-lite';

type Datum = { x: number; y: number; group: string };

function makeData(n = 240): Datum[] {
  const out: Datum[] = [];
  for (let i = 0; i < n; i++) {
    const group = i % 3 === 0 ? 'A' : i % 3 === 1 ? 'B' : 'C';
    out.push({ x: Math.random() * 100, y: Math.random() * 100, group });
  }
  return out;
}

export const meta = {
  id: 'linked-point-highlight',
  title: 'Linked views: click → highlight',
  description:
    'Click a point to select its group and highlight it across both views. This demonstrates linked selections without filtering away context.',
};

export function createSpec(): VegaLiteSpecLike {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { values: makeData() },
    params: [
      {
        name: 'baseOpacity',
        value: 0.25,
        bind: { input: 'range', min: 0.05, max: 0.9, step: 0.01 },
      },
      {
        name: 'pick',
        select: { type: 'point', fields: ['group'], on: 'click', clear: 'dblclick' },
      },
    ],
    vconcat: [
      {
        mark: { type: 'point', filled: true },
        encoding: {
          x: { field: 'x', type: 'quantitative' },
          y: { field: 'y', type: 'quantitative' },
          color: { field: 'group', type: 'nominal' },
          opacity: { condition: { param: 'pick', value: 0.95 }, expr: 'baseOpacity' },
        },
        width: 720,
        height: 300,
        title: 'Click a point (double-click to clear)',
      },
      {
        mark: { type: 'bar' },
        encoding: {
          x: { aggregate: 'count', type: 'quantitative', title: 'Count' },
          y: { field: 'group', type: 'nominal', title: null },
          color: { field: 'group', type: 'nominal', legend: null },
          opacity: { condition: { param: 'pick', value: 1.0 }, expr: 'baseOpacity' },
        },
        width: 720,
        height: 160,
        title: 'Linked highlight (same selection)',
      },
    ],
  };
}
