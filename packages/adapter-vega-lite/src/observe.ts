import { collectVegaLiteParams } from './params.js';
import type { buildParamLookup } from './execute.js';
import type { createVegaLiteTooltipBinding } from './tooltip.js';
import type { VegaLiteSpecLike, VegaViewLike } from './types.js';

export function createVegaLiteObservationBinding(args: {
  view: VegaViewLike;
  spec: VegaLiteSpecLike;
  helpers: ReturnType<typeof buildParamLookup>;
  tooltip: ReturnType<typeof createVegaLiteTooltipBinding>;
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
    const signals = new Set<string>();
    collectVegaLiteParams(args.spec).forEach((param) => {
      for (const name of args.helpers.watchedSignalsByParam.get(param.name) ?? [param.name]) signals.add(name);
    });
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
      if (args.view.addSignalListener && args.view.removeSignalListener) {
        for (const name of signals) {
          cleanup.push(() => args.view.removeSignalListener?.(name, notify));
          args.view.addSignalListener(name, notify);
        }
      }
      cleanup.push(args.tooltip.subscribe(notify));
      return detach;
    } catch (error) {
      detach();
      throw error;
    }
  };
  return {
    subscribe(listener: () => void) {
      if (disposed) throw new Error('Vega-Lite provider is disposed');
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
