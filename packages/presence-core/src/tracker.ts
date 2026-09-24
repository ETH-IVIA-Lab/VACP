import { untilAborted } from './wait';
import type { PresenceFocus } from './targets';
import type { PresenceFrame, PresenceGeometry, PresenceTarget } from './types';

function sameGeometry(a: PresenceGeometry, b: PresenceGeometry): boolean {
  if (a.kind === 'point' && b.kind === 'point') return a.point.x === b.point.x && a.point.y === b.point.y;
  if (a.kind === 'region' && b.kind === 'region')
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  if (a.kind === 'path' && b.kind === 'path')
    return (
      a.points.length === b.points.length && a.points.every((p, i) => p.x === b.points[i]!.x && p.y === b.points[i]!.y)
    );
  return false;
}

function sameTarget(a: PresenceTarget | null, b: PresenceTarget | null): boolean {
  if (!a || !b) return a === b;
  return a.surface === b.surface && a.precision === b.precision && sameGeometry(a.geometry, b.geometry);
}

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
  let delivered: PresenceTarget | null | undefined;
  // A lookup that finds the same target again changes nothing, unless a layout frame waits to confirm it.
  const offer = (target: PresenceTarget | null, reason: PresenceFrame['reason']) => {
    if (reason !== 'layout' && delivered !== undefined && sameTarget(delivered, target)) return;
    delivered = target;
    deliver(target, reason);
  };
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
      queued = undefined;
      delivered = undefined;
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
              // A lookup superseded or cancelled before it starts leaves the queued focus to its successor.
              if (current?.controller !== controller || signal.aborted) return;
              const wanted = queued!;
              queued = undefined;
              return resolve(wanted.focus, signal).then((target) => [target, wanted.reason] as const);
            })
            .then(
              (result) => {
                if (result && !signal.aborted) offer(result[0], result[1]);
              },
              (error) => {
                if (signal.aborted) return;
                offer(null, reason);
                report(error);
              },
            ),
          signal,
        ),
      };
    },
  };
}
