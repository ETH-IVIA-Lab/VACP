import { createSharedSubscription, createProviderSubscription } from '@vacp/runtime';
import type { VacpFreshness } from '@vacp/protocol';
import type { VegaLiteBindings } from './bindings';
import type { createVegaLiteTooltipBinding } from './tooltip';
import type { VegaViewLike } from './types';

const outputs = new WeakMap<VegaViewLike, VacpFreshness>();

const subscribeRun = createSharedSubscription<VegaViewLike>((view, invalidate) => {
  let active = true;
  let revision = 0;
  let pending = 0;
  outputs.delete(view);
  const run = view.runAsync;
  const wrapped = (...values: Parameters<VegaViewLike['runAsync']>): Promise<VegaViewLike> => {
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
      const result: Promise<VegaViewLike> = run.apply(view, values);
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
  const subscription = createProviderSubscription(
    (notify) => {
      const cleanup: Array<() => void> = [];
      const detach = () => {
        for (const restore of cleanup.reverse()) {
          try {
            restore();
          } catch {
            /* Release every owned hook. */
          }
        }
      };
      try {
        cleanup.push(subscribeRun(args.view, notify));
        const signals = new Set<string>();
        for (const binding of args.helpers.paramByRef.values()) for (const name of binding.signals) signals.add(name);
        for (const name of signals) {
          args.view.addSignalListener(name, notify);
          cleanup.push(() => args.view.removeSignalListener(name, notify));
        }
        cleanup.push(args.tooltip.subscribe(notify));
        return detach;
      } catch (error) {
        detach();
        throw error;
      }
    },
    { quietMs: 120 },
  );
  return { freshness: () => outputs.get(args.view), ...subscription };
}
