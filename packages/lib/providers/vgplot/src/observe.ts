import type { CollectedInput } from './inputs';
import type { VgplotPlotLike, VgplotTableLike } from './types';
import { wrapUpdate } from './runtime';

/**
 * Keep the runtime timeline "alive" by observing human-driven updates.
 *
 * VGPlot/vgplot doesn't provide a single high-level event stream for all
 * interactions, so we attach lightweight observers:
 * - input widget selection updates
 * - interactor selection updates
 */
export function installVgplotInputObservers(args: {
  inputs: CollectedInput[];
  notifyRuntime: (message: string, opts?: { immediate?: boolean }) => void;
}) {
  const { inputs, notifyRuntime } = args;
  for (const input of inputs) {
    if (input.input.selection) wrapUpdate(input.input.selection, 'input.selection.update', (m) => notifyRuntime(m));
  }
}

export function installVgplotPlotObservers(args: {
  plots: Array<{ plotId: string; plot: VgplotPlotLike; element: Element; svg?: SVGElement }>;
  notifyRuntime: (message: string, opts?: { immediate?: boolean }) => void;
}) {
  const { plots, notifyRuntime } = args;

  for (const { plot } of plots) {
    plot.interactors.forEach((it) => {
      const origInit = it.init;
      it.init = async (svgEl: SVGElement) => {
        const res = origInit ? await origInit.call(it, svgEl) : undefined;
        notifyRuntime('interactor.init', { immediate: true });
        if (it.selection) wrapUpdate(it.selection, 'selection.update', (m) => notifyRuntime(m));
        return res;
      };
      if (it.selection) wrapUpdate(it.selection, 'selection.update', (m) => notifyRuntime(m));
    });
  }
}

export function installVgplotTableObservers(args: {
  tables: Array<{ tableId: string; table: VgplotTableLike; element: Element }>;
  notifyRuntime: (message: string, opts?: { immediate?: boolean }) => void;
}) {
  const { tables, notifyRuntime } = args;

  for (const { table } of tables) {
    wrapUpdate(table, 'table.update', (m) => notifyRuntime(m));
    if (table.selection) wrapUpdate(table.selection, 'table.selection.update', (m) => notifyRuntime(m));
  }
}
