/**
 * Example entrypoint.
 *
 * This file composes:
 * - a normal D3 chart (`chart.ts`)
 * - an optional VACP layer (`vacp.ts`)
 */

import { installVacpDebugUi } from '@vacp/debug-ui';

import { createLassoScatterChart, makePoints } from './chart';
import { installVacpForD3ScatterLasso } from './vacp';

export function run(): void {
  const plotRoot = document.querySelector<HTMLDivElement>('#plot');
  const selectedEl = document.querySelector<HTMLSpanElement>('#selected');
  const clearBtn = document.querySelector<HTMLButtonElement>('#clear');
  if (!plotRoot || !selectedEl || !clearBtn) throw new Error('Missing root elements');

  const globalKey = '__vacp';
  installVacpDebugUi({ enabled: 'auto', globalKey });

  const data = makePoints();
  let notify = (_source: 'human' | 'agent' | 'debug' | 'system', _message: string) => {};

  const chart = createLassoScatterChart({
    root: plotRoot,
    data,
    onSelectionChanged: () => {
      selectedEl.textContent = String(chart.getSelectedCount());
      notify('human', 'lasso selection');
    },
  });

  const vacp = installVacpForD3ScatterLasso({
    root: plotRoot,
    svg: chart.svg,
    globalKey,
    title: 'D3 lasso scatter',
    data,
    getLassoPolygon: chart.getLassoPolygon,
    setLassoPolygon: chart.setLassoPolygon,
    getSelectedIds: chart.getSelectedIds,
    getSelectedCount: chart.getSelectedCount,
    clearSelection: chart.clearSelection,
  });
  notify = vacp.refresh;

  clearBtn.addEventListener('click', () => {
    chart.clearSelection();
    selectedEl.textContent = '0';
    notify('human', 'clear lasso');
  });

  chart.render();
  selectedEl.textContent = '0';
  notify('system', 'init');
}
