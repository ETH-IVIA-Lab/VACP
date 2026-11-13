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
 * One target lookup at a time. A lookup tries its places in order and delivers the first target found,
 * with the place that produced it. A burst of invalidations resolves the newest places once, late
 * results are dropped, and an arrival wait can observe the pending promise and the lookup's own signal.
 * The tracked sources stay watched for layout until `stop`, so a new step on the same surface keeps its
 * witness running. After a lookup that reaches an attached presentation, `answered` receives the places
 * those presentations answered, in order, and the place that produced the target.
 */
export function createTargetTracker(
  targets: {
    resolve: (focus: PresenceFocus, signal: AbortSignal) => Promise<PresenceTarget | null | undefined>;
    watch: (sourceId: PresenceFocus['sourceId']) => () => void;
  },
  deliver: (target: PresenceTarget | null, reason: PresenceFrame['reason'], place?: PresenceFocus) => void,
  report: (error: unknown) => void,
  answered: (asked: readonly PresenceFocus[], place: PresenceFocus | undefined) => void,
) {
  const { resolve } = targets;
  const watching = new Map<PresenceFocus['sourceId'], () => void>();
  const watch = (places: readonly PresenceFocus[]) => {
    const sources = new Set(places.map((place) => place.sourceId));
    for (const [sourceId, release] of watching)
      if (!sources.has(sourceId)) {
        watching.delete(sourceId);
        release();
      }
    for (const sourceId of sources) if (!watching.has(sourceId)) watching.set(sourceId, targets.watch(sourceId));
  };
  /** The first place that shows a target. An unplaceable or failing place leaves the next one to try. */
  const first = async (places: readonly PresenceFocus[], signal: AbortSignal) => {
    const asked: PresenceFocus[] = [];
    for (const place of places) {
      try {
        const target = await resolve(place, signal);
        if (target !== undefined) asked.push(place);
        if (target) return { target, place, asked };
      } catch (error) {
        if (signal.aborted) throw error;
        report(error);
      }
    }
    return { target: null, place: undefined, asked };
  };
  let current:
    | { controller: AbortController; promise: Promise<void>; reason: PresenceFrame['reason']; settled: boolean }
    | undefined;
  let queued: { places: readonly PresenceFocus[]; reason: PresenceFrame['reason'] } | undefined;
  let delivered: PresenceTarget | null | undefined;
  // A lookup that finds the same target again changes nothing, unless a layout frame waits to confirm it.
  const offer = (target: PresenceTarget | null, reason: PresenceFrame['reason'], place?: PresenceFocus) => {
    if (reason !== 'layout' && delivered !== undefined && sameTarget(delivered, target)) return;
    delivered = target;
    deliver(target, reason, place);
  };
  const cancel = () => {
    current?.controller.abort();
    current = undefined;
    queued = undefined;
    delivered = undefined;
  };
  const stop = () => {
    cancel();
    watch([]);
  };
  return {
    get pending() {
      return current?.promise;
    },
    get signal() {
      return current?.controller.signal;
    },
    /** Drop the pending lookup and forget the delivered target. The sources stay watched. */
    cancel,
    /** Drop the pending lookup and stop watching the sources. */
    stop,
    track(places: readonly PresenceFocus[], requested: PresenceFrame['reason'], lifetime: AbortSignal) {
      if (lifetime.aborted) return stop();
      watch(places);
      // A step's lookup superseded by layout still arrives as the step, so the cursor travels to it.
      const reason = current && !current.settled && current.reason === 'activity' ? 'activity' : requested;
      if (queued) {
        queued = { places, reason };
        current!.reason = reason;
        return;
      }
      current?.controller.abort();
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, lifetime]);
      queued = { places, reason };
      const lookup = {
        controller,
        reason,
        settled: false,
        promise: untilAborted(
          Promise.resolve()
            .then(() => {
              // A lookup superseded or cancelled before it starts leaves the queued places to its successor.
              if (current !== lookup || signal.aborted) return;
              const wanted = queued!;
              queued = undefined;
              return first(wanted.places, signal).then((found) => ({ ...found, reason: wanted.reason }));
            })
            .then(
              (result) => {
                if (!result || signal.aborted) return;
                lookup.settled = true;
                // Delivery runs host code that can end the step, so its placement records the lookup first.
                if (result.asked.length) answered(result.asked, result.place);
                offer(result.target, result.reason, result.place);
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
