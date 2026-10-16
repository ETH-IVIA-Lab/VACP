import { createProviderSubscription } from '@vacp/runtime';
import { observeNativeUpdate, observeNativePlot, observeNativeInteractor, plotFreshness } from './native-observation';
import type { VgplotBindings } from './bindings';

/** Observe the same native identities used by state, actions and presentation. */
export function createVgplotObservationBinding(bindings: VgplotBindings) {
  const subscription = createProviderSubscription(
    (notify) => {
      const cleanup: Array<() => void> = [];
      const observeUpdate = (owner: Parameters<typeof observeNativeUpdate>[0] | undefined) => {
        if (owner) cleanup.push(observeNativeUpdate(owner, notify));
      };
      const detach = () => {
        for (const restore of cleanup.reverse()) {
          try {
            restore();
          } catch {
            /* Continue releasing the remaining bindings. */
          }
        }
      };
      try {
        for (const input of bindings.inputs) observeUpdate(input.input.selection);
        for (const { table } of bindings.tables) {
          observeUpdate(table);
          observeUpdate(table.selection);
        }
        for (const { plot } of bindings.plots) {
          for (const { legend } of bindings.legends(plot)) observeUpdate(legend.selection);
          cleanup.push(observeNativePlot(plot, notify));
          for (const { interactor } of bindings.interactors(plot))
            cleanup.push(observeNativeInteractor(interactor, notify));
        }
        return detach;
      } catch (error) {
        detach();
        throw error;
      }
    },
    { quietMs: 120 },
  );
  return {
    freshness: plotFreshness,
    ...subscription,
  };
}
