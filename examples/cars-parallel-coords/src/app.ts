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
import { installVacpInspector } from '@vacp/inspector';

export async function run(): Promise<void> {
  const chartRoot = document.querySelector<HTMLDivElement>('#chart');
  const tooltip = document.querySelector<HTMLDivElement>('#tooltip');
  const resetBrushBtn = document.querySelector<HTMLButtonElement>('#reset-brush');
  const resetDimensionsBtn = document.querySelector<HTMLButtonElement>('#reset-dimensions');

  if (!chartRoot || !tooltip || !resetBrushBtn || !resetDimensionsBtn) {
    throw new Error('Missing root elements');
  }

  installVacpInspector();

  const { data, dimensions } = await loadCarsDataset('data/cars.csv');

  if (!data.length || !dimensions.length) throw new Error('Cars dataset is empty');

  let notify = (_source: 'human' | 'agent' | 'inspector' | 'system', _message: string) => {};

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
    title: 'Cars parallel coordinates',
    data,
    dimensions,
    getState: chart.getState,
    getSelectedIds: chart.getSelectedIds,
    setBrushRanges: chart.setBrushRanges,
    resetBrushes: chart.resetBrushes,
    setDimensionOrder: chart.setDimensionOrder,
    resetDimensionOrder: chart.resetDimensionOrder,
    setHoveredId: chart.setHoveredId,
  });

  notify = vacp.refresh;

  resetBrushBtn.addEventListener('click', () => chart.resetBrushes('human'));
  resetDimensionsBtn.addEventListener('click', () => chart.resetDimensionOrder('human'));

  window.addEventListener('resize', () => chart.render());

  notify('system', 'init');
}
