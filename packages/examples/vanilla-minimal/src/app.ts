/**
 * Example entrypoint.
 *
 * This file composes two layers:
 * 1) the visualization (plain SVG; no VACP)
 * 2) the VACP integration (graph/actions/state + DuckDB)
 */

import { installVacpDebugUI } from '@vacp/kit';

import { createScatterPlot, randomData } from './plot';
import { installVacpForVanillaScatter } from './vacp';

export async function run(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  const clearBtn = document.querySelector<HTMLButtonElement>('#clear');
  if (!app || !clearBtn) throw new Error('Missing root elements');

  // Dev-only overlay: inspects the VACP bridge and provides time travel + actions + DuckDB SQL.
  void installVacpDebugUI();

  // Example data + UI state: selection is local, and VACP reads/writes it via actions/state snapshots.
  const data = randomData();
  const selectedIds = new Set<number>();

  let notify = (_source: 'human' | 'agent' | 'debug' | 'system', _message: string) => {};

  // Visualization: plain SVG scatterplot (no VACP knowledge).
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

  // VACP integration: graph + actions + DuckDB queries, layered on top of the chart.
  const vacp = await installVacpForVanillaScatter({
    root: app,
    svg: plot.svg,
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

  // UI wiring: the human button triggers the same selection semantics as agent actions.
  clearBtn.addEventListener('click', () => {
    selectedIds.clear();
    plot.update(selectedIds);
    notify('human', 'clear selection');
  });

  plot.update(selectedIds);
  notify('system', 'init');
}
