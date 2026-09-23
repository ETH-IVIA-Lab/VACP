import { untilAborted } from './wait';
import type { PresenceFocus } from './targets';
import type { PresenceFrame, PresenceTarget } from './types';

/**
 * One target lookup at a time. A burst of invalidations resolves the newest focus once, late results
 * are dropped, and an arrival wait can observe the pending promise and the lookup's own signal.
 */
export function createTargetTracker(
  resolve: (focus: PresenceFocus, signal: AbortSignal) => Promise<PresenceTarget | null>,
  deliver: (target: PresenceTarget | null, reason: PresenceFrame['reason']) => void,
  report: (error: unknown) => void,
) {
  let current: { controller: AbortController; promise: Promise<void> } | undefined;
  let queued: { focus: PresenceFocus; reason: PresenceFrame['reason'] } | undefined;
  return {
    get pending() {
      return current?.promise;
    },
    get signal() {
      return current?.controller.signal;
    },
    cancel() {
      current?.controller.abort();
      current = undefined;
    },
    track(focus: PresenceFocus, reason: PresenceFrame['reason'], lifetime: AbortSignal) {
      if (queued) {
        queued = { focus, reason };
        return;
      }
      current?.controller.abort();
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, lifetime]);
      queued = { focus, reason };
      current = {
        controller,
        promise: untilAborted(
          Promise.resolve()
            .then(() => {
              const wanted = queued!;
              queued = undefined;
              if (!signal.aborted)
                return resolve(wanted.focus, signal).then((target) => [target, wanted.reason] as const);
            })
            .then(
              (result) => {
                if (result && !signal.aborted) deliver(result[0], result[1]);
              },
              (error) => {
                if (signal.aborted) return;
                deliver(null, reason);
                report(error);
              },
            ),
          signal,
        ),
      };
    },
  };
}
