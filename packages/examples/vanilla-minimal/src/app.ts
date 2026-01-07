/**
 * Example entrypoint.
 *
 * This file composes two layers:
 * 1) the visualization (plain SVG; no VACP)
 * 2) the VACP integration (graph/actions/state + DuckDB + annotations)
 */

import { installVacpDebugUi } from '@vacp/debug-ui';

import { createScatterPlot, randomData } from './plot';
import { installVacpForVanillaScatter } from './vacp';

export async function run(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  const clearBtn = document.querySelector<HTMLButtonElement>('#clear');
  if (!app || !clearBtn) throw new Error('Missing root elements');

  const globalKey = '__vacp';
  installVacpDebugUi({ enabled: 'auto', globalKey });

  const data = randomData();
  const selectedIds = new Set<number>();

  let notify = (_source: 'human' | 'agent' | 'debug' | 'system', _message: string) => {};

  const plot = createScatterPlot({
    root: app,
    data,
    onToggle: (id) => {
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);
      plot.update(selectedIds);
      notify('human', 'click selection');
    },
  });

  const vacp = await installVacpForVanillaScatter({
    root: app,
    svg: plot.svg,
    globalKey,
    data,
    selectedIds,
    onSetSelectedIds: (ids) => {
      selectedIds.clear();
      ids.forEach((id) => selectedIds.add(id));
      plot.update(selectedIds);
      notify('agent', 'apply selection');
    },
  });
  notify = vacp.refresh;

  clearBtn.addEventListener('click', () => {
    selectedIds.clear();
    plot.update(selectedIds);
    notify('human', 'clear selection');
  });

  plot.update(selectedIds);
  notify('system', 'init');
}
