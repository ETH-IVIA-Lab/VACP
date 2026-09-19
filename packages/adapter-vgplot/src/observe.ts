import { plotLegends } from './legends.js';
import {
  observeNativeUpdate,
  observeNativePlot,
  observeNativeInteractor,
  plotFreshness,
} from './native-observation.js';
import type { CollectedInput } from './inputs.js';
import type { VgplotPlotLike, VgplotTableLike } from './types.js';

/** Observe a live dashboard while consumers are subscribed. */
export function createVgplotObservationBinding(args: {
  inputs: CollectedInput[];
  plots: Array<{ plot: VgplotPlotLike }>;
  tables: Array<{ table: VgplotTableLike }>;
}) {
  const listeners = new Set<() => void>();
  let release: (() => void) | undefined;
  let disposed = false;

  const bind = () => {
    const cleanup: Array<() => void> = [];
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const notify = () => {
      if (!active || timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch {
            /* A consumer must not interrupt source observation. */
          }
        }
      }, 120);
    };
    const observeUpdate = (owner: Parameters<typeof observeNativeUpdate>[0] | undefined) => {
      if (owner) cleanup.push(observeNativeUpdate(owner, notify));
    };
    const detach = () => {
      active = false;
      clearTimeout(timer);
      for (const restore of cleanup.reverse()) {
        try {
          restore();
        } catch {
          /* Continue releasing the remaining bindings. */
        }
      }
    };
    try {
      for (const input of args.inputs) observeUpdate(input.input.selection);
      for (const { table } of args.tables) {
        observeUpdate(table);
        observeUpdate(table.selection);
      }
      for (const { plot } of args.plots) {
        for (const legend of plotLegends(plot)) observeUpdate(legend.selection);
        cleanup.push(observeNativePlot(plot, notify));
        for (const interactor of plot.interactors) cleanup.push(observeNativeInteractor(interactor, notify));
      }
      return detach;
    } catch (error) {
      detach();
      throw error;
    }
  };
  return {
    freshness: plotFreshness,
    subscribe(listener: () => void) {
      if (disposed) throw new Error('VGPlot provider is disposed');
      const notify = () => listener();
      listeners.add(notify);
      try {
        release ??= bind();
      } catch (error) {
        listeners.delete(notify);
        throw error;
      }
      return () => {
        listeners.delete(notify);
        if (listeners.size === 0) {
          release?.();
          release = undefined;
        }
      };
    },
    dispose() {
      disposed = true;
      release?.();
      release = undefined;
      listeners.clear();
    },
  };
}
