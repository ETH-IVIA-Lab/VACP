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
 * are dropped, and an arrival wait can observe the pending promise and the lookup's own signal. The
 * tracked source stays watched for layout until `stop`, so a new step on the same surface keeps its
 * witness running.
 */
export function createTargetTracker(
  targets: {
    resolve: (focus: PresenceFocus, signal: AbortSignal) => Promise<PresenceTarget | null>;
    watch: (sourceId: PresenceFocus['sourceId']) => () => void;
  },
  deliver: (target: PresenceTarget | null, reason: PresenceFrame['reason']) => void,
  report: (error: unknown) => void,
) {
  const { resolve } = targets;
  let watching: { sourceId: PresenceFocus['sourceId']; release: () => void } | undefined;
  const watch = (sourceId: PresenceFocus['sourceId']) => {
    if (watching?.sourceId === sourceId) return;
    watching?.release();
    watching = { sourceId, release: targets.watch(sourceId) };
  };
  let current:
    | { controller: AbortController; promise: Promise<void>; reason: PresenceFrame['reason']; settled: boolean }
    | undefined;
  let queued: { focus: PresenceFocus; reason: PresenceFrame['reason'] } | undefined;
  let delivered: PresenceTarget | null | undefined;
  // A lookup that finds the same target again changes nothing, unless a layout frame waits to confirm it.
  const offer = (target: PresenceTarget | null, reason: PresenceFrame['reason']) => {
    if (reason !== 'layout' && delivered !== undefined && sameTarget(delivered, target)) return;
    delivered = target;
    deliver(target, reason);
  };
  const cancel = () => {
    current?.controller.abort();
    current = undefined;
    queued = undefined;
    delivered = undefined;
  };
  const stop = () => {
    cancel();
    watching?.release();
    watching = undefined;
  };
  return {
    get pending() {
      return current?.promise;
    },
    get signal() {
      return current?.controller.signal;
    },
    /** Drop the pending lookup and forget the delivered target. The source stays watched. */
    cancel,
    /** Drop the pending lookup and stop watching the source. */
    stop,
    track(focus: PresenceFocus, requested: PresenceFrame['reason'], lifetime: AbortSignal) {
      if (lifetime.aborted) return stop();
      watch(focus.sourceId);
      // A step's lookup superseded by layout still arrives as the step, so the cursor travels to it.
      const reason = current && !current.settled && current.reason === 'activity' ? 'activity' : requested;
      if (queued) {
        queued = { focus, reason };
        current!.reason = reason;
        return;
      }
      current?.controller.abort();
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, lifetime]);
      queued = { focus, reason };
      const lookup = {
        controller,
        reason,
        settled: false,
        promise: untilAborted(
          Promise.resolve()
            .then(() => {
              // A lookup superseded or cancelled before it starts leaves the queued focus to its successor.
              if (current !== lookup || signal.aborted) return;
              const wanted = queued!;
              queued = undefined;
              return resolve(wanted.focus, signal).then((target) => [target, wanted.reason] as const);
            })
            .then(
              (result) => {
                if (!result || signal.aborted) return;
                lookup.settled = true;
                offer(result[0], result[1]);
              },
              (error) => {
                if (signal.aborted) return;
                lookup.settled = true;
                offer(null, lookup.reason);
                report(error);
              },
            ),
          signal,
        ),
      };
      current = lookup;
    },
  };
}
