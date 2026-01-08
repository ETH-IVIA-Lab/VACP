import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

export function buildD3ScatterLassoPlaybooks(): VacpPlaybook[] {
  return [
    playbook({
      id: 'd3-lasso-basic',
      title: 'Bidirectional lasso selection',
      description: 'Programmatically set/clear the lasso polygon the same way an agent would.',
    })
      .action('Clear lasso', { name: 'vanilla.clear_lasso', params: {} })
      .action('Set lasso (square)', {
        name: 'vanilla.set_lasso_polygon',
        params: {
          points: [
            { x: 20, y: 20 },
            { x: 80, y: 20 },
            { x: 80, y: 80 },
            { x: 20, y: 80 },
          ],
        },
      })
      .action('Set lasso (32-vertex polygon)', {
        name: 'vanilla.set_lasso_polygon',
        params: {
          points: [
            { x: 80, y: 50 },
            { x: 79.424, y: 55.852 },
            { x: 77.716, y: 61.481 },
            { x: 74.944, y: 66.667 },
            { x: 71.213, y: 71.213 },
            { x: 66.667, y: 74.944 },
            { x: 61.481, y: 77.716 },
            { x: 55.852, y: 79.424 },
            { x: 50, y: 80 },
            { x: 44.148, y: 79.424 },
            { x: 38.519, y: 77.716 },
            { x: 33.333, y: 74.944 },
            { x: 28.787, y: 71.213 },
            { x: 25.056, y: 66.667 },
            { x: 22.284, y: 61.481 },
            { x: 20.576, y: 55.852 },
            { x: 20, y: 50 },
            { x: 20.576, y: 44.148 },
            { x: 22.284, y: 38.519 },
            { x: 25.056, y: 33.333 },
            { x: 28.787, y: 28.787 },
            { x: 33.333, y: 25.056 },
            { x: 38.519, y: 22.284 },
            { x: 44.148, y: 20.576 },
            { x: 50, y: 20 },
            { x: 55.852, y: 20.576 },
            { x: 61.481, y: 22.284 },
            { x: 66.667, y: 25.056 },
            { x: 71.213, y: 28.787 },
            { x: 74.944, y: 33.333 },
            { x: 77.716, y: 38.519 },
            { x: 79.424, y: 44.148 },
          ],
        },
      })
      .action('Clear lasso again', { name: 'vanilla.clear_lasso', params: {} })
      .build(),
  ];
}

