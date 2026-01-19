/**
 * Example entrypoint.
 *
 * This file composes:
 * - a normal D3 chart (`chart.ts`)
 * - an optional VACP layer (`vacp.ts`)
 */

import { createParallelCoordsChart } from './chart';
import { loadCarsDataset } from './data';
import { installVacpForCarsParallelCoords } from './vacp';

function shouldEnableDebugUi(): boolean {
  try {
    const url = new URL(window.location.href);
    const qp = url.searchParams.get('vacp-debug');
    if (qp === '1') return true;
    if (qp === '0') return false;
  } catch {
    // ignore
  }
  try {
    const v = window.localStorage.getItem('vacp:debug');
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {
    // ignore
  }
  return String(import.meta.env.VACP_DEBUG_UI ?? '') === '1';
}

export async function run(): Promise<void> {
  const chartRoot = document.querySelector<HTMLDivElement>('#chart');
  const tooltip = document.querySelector<HTMLDivElement>('#tooltip');
  const resetBrushBtn = document.querySelector<HTMLButtonElement>('#reset-brush');
  const resetDimensionsBtn = document.querySelector<HTMLButtonElement>('#reset-dimensions');
  if (!chartRoot || !tooltip || !resetBrushBtn || !resetDimensionsBtn) {
    throw new Error('Missing root elements');
  }

  const globalKey = '__vacp';
  if (shouldEnableDebugUi()) {
    const { installVacpDebugUi } = await import('@vacp/debug-ui');
    // Dev-only overlay: inspects the VACP bridge and provides time travel + actions + DuckDB SQL.
    installVacpDebugUi({ enabled: 'auto', globalKey });
  }

  const { data, dimensions } = await loadCarsDataset('data/cars.csv');
  if (!data.length || !dimensions.length) throw new Error('Cars dataset is empty');

  let notify = (_source: 'human' | 'agent' | 'debug' | 'system', _message: string) => {};

  const chart = createParallelCoordsChart({
    root: chartRoot,
    tooltip,
    data,
    dimensions,
    onStateChange: (st, change) => {
      if (change.source === 'human') notify('human', change.message);
      void st;
    },
  });

  const vacp = installVacpForCarsParallelCoords({
    root: chartRoot,
    globalKey,
    title: 'Cars parallel coordinates',
    data,
    dimensions,
    getState: chart.getState,
    setBrushRanges: chart.setBrushRanges,
    resetBrushes: chart.resetBrushes,
    setDimensionOrder: chart.setDimensionOrder,
    resetDimensionOrder: chart.resetDimensionOrder,
  });
  notify = vacp.refresh;

  resetBrushBtn.addEventListener('click', () => chart.resetBrushes('human'));
  resetDimensionsBtn.addEventListener('click', () => chart.resetDimensionOrder('human'));

  window.addEventListener('resize', () => chart.render());

  notify('system', 'init');
}
