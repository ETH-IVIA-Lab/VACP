import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

export function buildD3ScatterLassoPlaybooks(): VacpPlaybook[] {
  const circle32 = (cx: number, cy: number, r: number): Array<{ x: number; y: number }> => {
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 32; i++) {
      const t = (i / 32) * Math.PI * 2;
      out.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r });
    }
    return out;
  };

  return [
    playbook({
      id: 'd3-scatter-lasso-basic',
      title: 'Playbook: D3 scatter lasso (select regions)',
      description:
        'Answer: “Can I drive the same lasso selection a user would draw?” by setting a couple of lasso polygons (domain coordinates) and leaving the final region selected.',
    })
      .action('Clear lasso', { name: 'vanilla.clear_lasso', params: {} })
      .action('Select lower-left region (square lasso)', {
        name: 'vanilla.set_lasso_polygon',
        params: {
          points: [
            { x: 5, y: 5 },
            { x: 45, y: 5 },
            { x: 45, y: 45 },
            { x: 5, y: 45 },
          ],
        },
      })
      .action('Clear lasso (reset)', { name: 'vanilla.clear_lasso', params: {} })
      .action('Select a circular region (smooth lasso)', {
        name: 'vanilla.set_lasso_polygon',
        params: {
          points: circle32(70, 70, 18),
        },
      })
      .note('Done', 'The circular lasso remains active so the filtered region stays visible after “Run all”.')
      .build(),
  ];
}
