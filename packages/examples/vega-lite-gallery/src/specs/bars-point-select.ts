import type { VegaLiteSpecLike } from '@vacp/vega-lite';

import { makeCategoryValues } from '../spec-data';

export const meta = {
  id: 'bars-point-select',
  title: 'KPI bars: pick a category + adjust context',
  description:
    'Click a bar to select a category; use the slider to fade the non-selected context in/out. VACP exposes both the scalar param and the selection param.',
};

export function createSpec(): VegaLiteSpecLike {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { values: makeCategoryValues() },
    params: [
      {
        name: 'baseOpacity',
        value: 0.35,
        bind: { input: 'range', min: 0.05, max: 0.95, step: 0.05 },
      },
      {
        name: 'pick',
        select: { type: 'point', encodings: ['x'], on: 'click', clear: 'dblclick' },
      },
    ],
    mark: { type: 'bar', cornerRadiusTopLeft: 4, cornerRadiusTopRight: 4 },
    encoding: {
      x: { field: 'category', type: 'nominal', axis: { labelAngle: 0 } },
      y: { field: 'value', type: 'quantitative' },
      color: { condition: { param: 'pick', value: '#2563eb' }, value: '#cbd5e1' },
      opacity: { condition: { param: 'pick', value: 1 }, expr: 'baseOpacity' },
      tooltip: [
        { field: 'category', type: 'nominal', title: 'Category' },
        { field: 'value', type: 'quantitative', title: 'Value' },
      ],
    },
    width: 520,
    height: 260,
  };
}
