import { createSharedSubscription } from '@vacp/runtime';
import type { VacpFreshness } from '@vacp/protocol';
import type { VegaLiteBindings } from './bindings.js';
import type { createVegaLiteTooltipBinding } from './tooltip.js';
import type { VegaViewLike } from './types.js';

const outputs = new WeakMap<VegaViewLike, VacpFreshness>();

const subscribeRun = createSharedSubscription<VegaViewLike>((view, invalidate) => {
  let active = true;
  let revision = 0;
  let pending = 0;
  outputs.delete(view);
  const run = view.runAsync;
  const wrapped: VegaViewLike['runAsync'] = (...values) => {
    const inputRevision = String(++revision);
    pending++;
    outputs.set(view, { status: 'running', inputRevision });
    invalidate();
    const failed = (error: unknown) => {
      pending--;
      if (active)
        outputs.set(view, {
          status: 'error',
          inputRevision,
          message: error instanceof Error ? error.message : String(error),
        });
      invalidate();
    };
    try {
      const result = run.apply(view, values);
      void result.then(() => {
        pending--;
        if (active && pending === 0)
          outputs.set(view, { status: 'current', inputRevision: String(revision), outputRevision: String(revision) });
        invalidate();
      }, failed);
      return result;
    } catch (error) {
      failed(error);
      throw error;
    }
  };
  view.runAsync = wrapped;
  return () => {
    active = false;
    if (view.runAsync === wrapped) view.runAsync = run;
    outputs.delete(view);
  };
});

export function createVegaLiteObservationBinding(args: {
  view: VegaViewLike;
  helpers: VegaLiteBindings;
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
    for (const binding of args.helpers.paramByRef.values()) for (const name of binding.signals) signals.add(name);
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
      cleanup.push(subscribeRun(args.view, notify));
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
    freshness: () => outputs.get(args.view),
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
