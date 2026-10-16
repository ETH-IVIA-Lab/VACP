import {
  presenceAnchor,
  type PresenceActivity,
  type PresenceFrame,
  type PresenceGeometry,
  type PresencePoint,
} from '@vacp/presence-core';
import { immutableGeometry, targetBounds } from './bubble-layout';
import { createBubbleMotion } from './bubble-motion';
import type { PresenceEngine } from './engine';
import { spring, travelScale } from './motion';
import type { PresenceConfig } from './options';

type Part = 'layer' | 'float' | 'travel' | 'cue';
/** One acknowledgement of an execution, at the point where the pointer rested. */
export type Activation = { id: number; point: PresencePoint };

/**
 * Critically damped travel toward the resting point. The label keeps its offset from the cursor as
 * the flight begins and eases it toward its resting offset as the cursor arrives.
 */
type Flight = {
  position: PresencePoint;
  /** Cursor and label where the flight began, fixing the label's starting offset. */
  from: PresencePoint;
  label: PresencePoint;
  velocity: PresencePoint;
  started: number;
  previous: number;
  startScale: number;
  scale: number;
  distance: number;
};

/**
 * `floating` has never been located and sits at a fallback point. `hidden` lost its target to
 * clipping. `stale` waits for a fresh layout frame after the surface moved.
 */
type Visibility = 'floating' | 'visible' | 'hidden' | 'stale';

const outlines = new WeakMap<PresenceGeometry, string>();
function outline(geometry: PresenceGeometry | undefined): string {
  if (!geometry) return '';
  const cached = outlines.get(geometry);
  if (cached !== undefined) return cached;
  const path =
    geometry.kind === 'region'
      ? `M${geometry.x},${geometry.y}h${geometry.width}v${geometry.height}h${-geometry.width}Z`
      : geometry.kind === 'path'
        ? geometry.points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ')
        : '';
  if (immutableGeometry(geometry)) outlines.set(geometry, path);
  return path;
}

function write(element: Element, name: string, value: string) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

/**
 * One pointer: where it rests, how it travels, what it outlines, and its label's placement. It is the
 * only writer of the pointer's geometry, runs outside React renders, and never dispatches input, moves
 * focus, or scrolls the application.
 */
export function createPointerMotion(options: {
  engine: PresenceEngine;
  config: PresenceConfig;
  /** Where the actor rested before, and how many pointers were present when this one appeared. */
  start: PresencePoint | undefined;
  stack: number;
  /** The pointer finished fading out. */
  exited: () => void;
  /** The cursor acknowledged an execution, which its components draw. */
  acknowledged: () => void;
}) {
  const { engine, config, stack } = options;
  const bubble = createBubbleMotion(config.bubbleWidth);
  const parts: Partial<Record<Part, HTMLElement | SVGElement>> = {};
  let activity: PresenceActivity | undefined;
  let executionId: string | undefined;
  let at: PresencePoint | undefined;
  let flight: Flight | null = null;
  let beside: PresenceGeometry | undefined;
  let visibility: Visibility = 'floating';
  let activated = false;
  let exiting = false;
  let fading: Animation[] = [];
  let hovering: Animation | undefined;
  let settling: Animation | undefined;
  let translation = '';
  let stopFrames: (() => void) | undefined;
  const waits = new Set<() => void>();
  let activation: Activation | null = null;
  const watchers = new Set<() => void>();

  const still = () => engine.motion.get().still;
  const reduced = () => engine.motion.get().reduced;
  const position = () => flight?.position ?? at ?? { x: 0, y: 0 };
  const acknowledge = (next: Activation | null) => {
    if (next === activation) return;
    activation = next;
    for (const watcher of watchers) watcher();
    options.acknowledged();
  };
  /** Release every arrival wait: the pointer landed, moved on to another execution, or left. */
  const arrived = () => {
    for (const resolve of [...waits]) resolve();
  };

  /** The point a step rests at, or where the pointer keeps waiting when the step has no located target. */
  const destination = (next: PresenceActivity) => {
    const { target } = next;
    let point = target?.surface === config.surface ? presenceAnchor(target.geometry) : null;
    const size = engine.viewport();
    // An off-screen target keeps the bubble at the viewport edge nearest to where the agent acted.
    let beyond = false;
    if (point && target) {
      const bounds = targetBounds(target.geometry, 0);
      beyond =
        bounds.x + bounds.width <= 0 ||
        bounds.y + bounds.height <= 0 ||
        bounds.x >= size.width ||
        bounds.y >= size.height;
    }
    const located = point !== null && !beyond;
    point ??= at ??
      options.start ??
      config.idlePosition?.(size) ?? {
        x: Math.max(24, size.width - config.bubbleWidth - 64),
        y: Math.min(92 + stack * 110, size.height * 0.6),
      };
    return {
      point: {
        x: Math.max(12, Math.min(size.width - 12, point.x)),
        y: Math.max(12, Math.min(size.height - 12, point.y)),
      },
      located,
      beyond,
      geometry: located ? target!.geometry : undefined,
    };
  };

  const land = () => {
    flight = null;
    stopFrames?.();
    stopFrames = undefined;
    arrived();
  };

  /** The only writer of `at` and `flight`. */
  const move = (point: PresencePoint, reason: PresenceFrame['reason'], now: number) => {
    if (!at) {
      at = point;
      return;
    }
    const dx = point.x - at.x;
    const dy = point.y - at.y;
    if (!dx && !dy) return;
    const from = flight?.position ?? at;
    at = point;
    if (reason === 'layout') {
      // The surface moved under the cursor: shift the whole flight, never restart or cut it.
      const shift = (value: PresencePoint) => ({ x: value.x + dx, y: value.y + dy });
      if (flight)
        Object.assign(flight, {
          position: shift(flight.position),
          from: shift(flight.from),
          label: shift(flight.label),
        });
      return;
    }
    if (reduced() || config.duration === 0) return land();
    flight = {
      position: from,
      from,
      label: bubble.painted(),
      velocity: flight?.velocity ?? { x: 0, y: 0 },
      started: now,
      previous: now,
      startScale: flight?.scale ?? 1,
      scale: flight?.scale ?? 1,
      distance: Math.hypot(point.x - from.x, point.y - from.y),
    };
    stopFrames ??= engine.animate(tick);
  };

  const step = (now: number) => {
    const current = flight!;
    const target = at!;
    const dt = Math.max(0, now - current.previous);
    const progress = Math.min(1, (now - current.started) / config.duration);
    const omega = 8 / config.duration;
    const x = spring(current.position.x, current.velocity.x, target.x, dt, omega);
    const y = spring(current.position.y, current.velocity.y, target.y, dt, omega);
    current.position = { x: x.position, y: y.position };
    current.velocity = { x: x.velocity, y: y.velocity };
    current.previous = now;
    current.scale = travelScale(progress, current.distance, current.startScale, config.travel);
    const settled =
      Math.hypot(current.position.x - target.x, current.position.y - target.y) < 0.2 &&
      Math.hypot(x.velocity, y.velocity) < 0.01;
    if (still() || settled) land();
  };

  /** Cursor, cue, and label follow the pointer state. */
  const paint = (instant: boolean) => {
    const { layer, travel, cue } = parts;
    if (!layer || !travel || !cue || !at || !activity) return;
    const now = position();
    const next = `translate(${now.x}px,${now.y}px)`;
    if (translation !== next) {
      translation = next;
      layer.style.transform = next;
    }
    write(travel, 'transform', `scale(${flight?.scale ?? 1})`);
    const shown = visibility === 'visible' || visibility === 'floating';
    layer.style.visibility = shown ? 'visible' : 'hidden';
    cue.style.visibility = shown ? 'visible' : 'hidden';
    bubble.show(visibility !== 'stale');
    if (flight) {
      const rest = bubble.plan(at, engine.viewport(), beside);
      const remaining = Math.hypot(at.x - now.x, at.y - now.y);
      const progress = flight.distance > 0 ? Math.max(0, Math.min(1, 1 - remaining / flight.distance)) : 1;
      const eased = 1 - (1 - progress) ** 3;
      const offset = (start: number, cursorStart: number, end: number, target: number) =>
        start - cursorStart + (end - target - (start - cursorStart)) * eased;
      bubble.follow(
        now.x + offset(flight.label.x, flight.from.x, rest.x, at.x),
        now.y + offset(flight.label.y, flight.from.y, rest.y, at.y),
      );
    } else bubble.place(at, engine.viewport(), beside, instant);
    // Thinking, and frames about the whole request such as its start and conclusion, outline no step.
    const path = !config.cue.visible || activity.phase === 'thinking' || !activity.target ? '' : outline(beside);
    write(cue, 'd', path);
    write(cue, 'data-precision', activity.target?.precision ?? 'surface');
    write(cue, 'stroke-dasharray', activity.target?.precision === 'surface' ? '3 4' : '');
  };

  /** Quiet thinking motion runs on the compositor; leaving it eases back from the painted offset. */
  const hover = () => {
    const { float } = parts;
    if (!float) return;
    const wanted = !exiting && activity?.phase === 'thinking' && !flight && config.hoverDistance > 0 && !still();
    if (still() || wanted) {
      settling?.cancel();
      settling = undefined;
    }
    if (wanted === !!hovering) return;
    if (wanted) {
      hovering = float.animate(
        [
          { transform: `translateY(${-config.hoverDistance}px)` },
          { transform: `translateY(${config.hoverDistance}px)` },
        ],
        {
          duration: config.hoverPeriod / 2,
          direction: 'alternate',
          easing: 'ease-in-out',
          iterations: Infinity,
          iterationStart: 0.5,
        },
      );
      return;
    }
    const view = engine.view;
    const offset = new view.DOMMatrixReadOnly(view.getComputedStyle(float).transform).f;
    hovering!.cancel();
    hovering = undefined;
    if (!still() && Math.abs(offset) > 0.01)
      settling = float.animate([{ transform: `translateY(${offset}px)` }, { transform: 'none' }], {
        duration: 160,
        easing: 'ease-out',
      });
  };

  /** Feedback plays once per execution, at rest on a located target. */
  const activate = () => {
    const phase = activity?.execution?.phase;
    if (
      !at ||
      activity?.phase === 'reviewing' ||
      !beside ||
      activated ||
      flight ||
      exiting ||
      (phase !== 'running' && phase !== 'succeeded')
    )
      return;
    activated = true;
    acknowledge({ id: (activation?.id ?? 0) + 1, point: at });
  };

  function tick(now: number) {
    if (!flight) return land();
    step(now);
    paint(reduced());
    if (!flight) hover();
    activate();
  }

  const binders: Partial<Record<Part, (element: HTMLElement | SVGElement | null) => () => void>> = {};
  return {
    bubble,
    /** A stable ref callback for one of the pointer's elements. */
    bind(part: Part) {
      return (binders[part] ??= (element: HTMLElement | SVGElement | null) => {
        if (element) {
          parts[part] = element;
          // A late-bound element takes the current geometry at once.
          if (activity) paint(true);
        }
        return () => {
          if (element && parts[part] === element) delete parts[part];
        };
      });
    },
    /** The acknowledgement the cursor plays, for components that draw it. */
    activation: {
      get: () => activation,
      subscribe(this: void, watcher: () => void) {
        watchers.add(watcher);
        return () => {
          watchers.delete(watcher);
        };
      },
    },
    travelling: (id: string) => id === executionId && !!flight && !exiting,
    /** Resolves when the pointer lands, moves on, or leaves. */
    arrival(signal: AbortSignal) {
      return new Promise<void>((resolve) => {
        const finish = () => {
          waits.delete(finish);
          signal.removeEventListener('abort', finish);
          resolve();
        };
        waits.add(finish);
        signal.addEventListener('abort', finish, { once: true });
        if (signal.aborted) finish();
      });
    },
    position,
    /** Apply one frame's activity. `changed` means the words changed, so the label is measured again. */
    sync(next: PresenceActivity, reason: PresenceFrame['reason'], changed: boolean) {
      if (executionId !== next.execution?.id) {
        arrived();
        acknowledge(null);
        activated = false;
      }
      if (next.phase === 'failed' || next.phase === 'cancelled') acknowledge(null);
      activity = next;
      executionId = next.execution?.id;
      const tracking = reason === 'layout';
      const dest = destination(next);
      // A stale pointer stays hidden until the layout frame that re-resolved its target arrives.
      if (visibility !== 'stale' || tracking)
        visibility = dest.located ? 'visible' : visibility === 'floating' ? 'floating' : 'hidden';
      // A read without spatial intent leaves the label beside the last selection.
      if (dest.located) beside = dest.geometry;
      else if (tracking || dest.beyond) beside = undefined;
      if (changed) bubble.invalidate();
      move(dest.point, reason, engine.now());
      paint(tracking || reduced() || config.duration === 0);
      hover();
      activate();
    },
    /** The viewport changed size: labels fit again, and a pointer without a target keeps inside the view. */
    reflow() {
      if (!activity) return;
      bubble.invalidate();
      if (!activity.target) move(destination(activity).point, 'layout', engine.now());
      if (visibility !== 'stale') paint(true);
    },
    /** Surfaces moved: a pointer placed on a target hides until the target is resolved again. */
    invalidate() {
      if (visibility === 'floating' || !activity?.target) return;
      visibility = 'stale';
      if (parts.layer) parts.layer.style.visibility = 'hidden';
      if (parts.cue) parts.cue.style.visibility = 'hidden';
      bubble.show(false);
    },
    /** Leave the frame with a short fade, or return to it. The pointer holds still while it fades. */
    exit(value: boolean) {
      if (exiting === value) return;
      exiting = value;
      for (const animation of fading) animation.cancel();
      fading = [];
      hover();
      if (!value) {
        if (flight) stopFrames ??= engine.animate(tick);
        return;
      }
      stopFrames?.();
      stopFrames = undefined;
      arrived();
      const fade = { duration: 180, easing: 'ease-out', fill: 'forwards' } as const;
      const elements = [parts.layer, parts.cue, bubble.root()].filter((element) => !!element);
      fading = elements.map((element) => element.animate([{ opacity: 1 }, { opacity: 0 }], fade));
      const done = fading[0];
      if (!done) return options.exited();
      void done.finished.then(
        () => {
          if (exiting && fading[0] === done) options.exited();
        },
        () => {},
      );
    },
    /** Reduced motion or a hidden document: finish travel and hold still. */
    settle() {
      if (still()) {
        acknowledge(null);
        bubble.stop();
        if (flight) land();
        paint(true);
      }
      hover();
    },
    dispose() {
      stopFrames?.();
      stopFrames = undefined;
      hovering?.cancel();
      settling?.cancel();
      for (const animation of fading) animation.cancel();
      bubble.stop();
      arrived();
      watchers.clear();
    },
  };
}

export type PointerMotion = ReturnType<typeof createPointerMotion>;
