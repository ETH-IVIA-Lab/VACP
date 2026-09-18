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
    const wrappedOwners = new WeakSet<object>();
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
    const observeUpdate = (owner: { update?: (...args: any[]) => unknown } | undefined) => {
      if (!owner?.update || wrappedOwners.has(owner)) return;
      wrappedOwners.add(owner);
      const original = owner.update;
      const wrapped = (...values: unknown[]) => {
        const result = original.apply(owner, values);
        notify();
        return result;
      };
      owner.update = wrapped;
      cleanup.push(() => {
        if (owner.update === wrapped) owner.update = original;
      });
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
        for (const interactor of plot.interactors) {
          observeUpdate(interactor.selection);
          const original = interactor.init;
          const wrapped = async (svg: SVGElement) => {
            const result = await original?.call(interactor, svg);
            if (active) {
              observeUpdate(interactor.selection);
              notify();
            }
            return result;
          };
          interactor.init = wrapped;
          cleanup.push(() => {
            if (interactor.init === wrapped) interactor.init = original;
          });
        }
      }
      return detach;
    } catch (error) {
      detach();
      throw error;
    }
  };
  return {
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
