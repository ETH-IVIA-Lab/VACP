/**
 * Example entrypoint.
 *
 * This file composes:
 * - a normal D3 chart (`chart.ts`)
 * - an optional VACP layer (`vacp.ts`)
 */

import { installVacpDebugUI } from '@vacp/kit';

import { createLassoScatterChart, makePoints } from './chart';
import { installVacpForD3ScatterLasso } from './vacp';

export function run(): void {
  const plotRoot = document.querySelector<HTMLDivElement>('#plot');
  const selectedEl = document.querySelector<HTMLSpanElement>('#selected');
  const clearBtn = document.querySelector<HTMLButtonElement>('#clear');
  if (!plotRoot || !selectedEl || !clearBtn) throw new Error('Missing root elements');

  // Dev-only overlay: inspects the VACP bridge and provides time travel + actions + DuckDB SQL.
  void installVacpDebugUI();

  // Example data: synthetic points to keep the demo fully self-contained.
  const data = makePoints();
  let notify = (_source: 'human' | 'agent' | 'debug' | 'system', _message: string) => {};

  // Visualization: plain D3 chart (no VACP knowledge).
  const chart = createLassoScatterChart({
    root: plotRoot,
    data,
    onSelectionChanged: ({ selectedCount, source }) => {
      selectedEl.textContent = String(selectedCount);
      if (source === 'human') notify('human', 'lasso selection');
    },
  });

  // VACP integration: graph + actions + DuckDB queries, layered on top of the chart.
  const vacp = installVacpForD3ScatterLasso({
    root: plotRoot,
    svg: chart.svg,
    title: 'D3 lasso scatter',
    data,
    getLassoPolygon: chart.getLassoPolygon,
    setLassoPolygon: chart.setLassoPolygon,
    getSelectedIds: chart.getSelectedIds,
    getSelectedCount: chart.getSelectedCount,
    clearSelection: chart.clearSelection,
  });
  notify = vacp.refresh;

  // UI wiring: the "human" button should be indistinguishable from agent-style actions.
  clearBtn.addEventListener('click', () => {
    chart.clearSelection();
    notify('human', 'clear lasso');
  });

  chart.render();
  selectedEl.textContent = '0';
  notify('system', 'init');
}
