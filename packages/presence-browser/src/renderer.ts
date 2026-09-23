import { immutableGeometry, targetBounds } from './bubble-layout';
import type { PresenceTextFactory } from './text';
import { travelScale, travelStyle, type CursorTravel } from './motion';
import { createCursorGraphic, cursorStyle, type CursorAppearance } from './cursor';
import { createPresenceBubble, describePresence, actorLabel } from './bubble';
import {
  presenceAnchor,
  type PresenceActivity,
  type PresenceFrame,
  type PresenceGeometry,
  type PresencePoint,
  type PresenceRenderer,
} from '@vacp/presence-core';
import { browserPresenceSurface } from './targets';
import { updateAttribute } from './svg';

export type BrowserPresenceOptions = CursorAppearance & {
  document?: Document;
  surface?: string;
  motion?: 'system' | 'reduced' | 'full';
  /** Approximate settling time. Retargeting preserves velocity. */
  durationMs?: number;
  travel?: CursorTravel;
  cue?: { color?: string; visible?: boolean };
  /** Optional public progress bubble. `icon` is stroked path data in a 24-unit square, shown for agents. */
  bubble?: false | { width?: number; icon?: string | false };
  /** Optional incremental text presentation. The default renders plain text. */
  text?: PresenceTextFactory;
  /** Quiet motion while the host reports thinking, in CSS pixels. */
  hover?: false | { distance?: number; periodMs?: number };
  /** Initial position for an actor without a known target. */
  idlePosition?: (viewport: { width: number; height: number }) => PresencePoint;
  zIndex?: number;
  describe?: (activity: PresenceActivity) => string;
};

/** Critically damped travel toward the resting point. */
type Flight = {
  position: PresencePoint;
  velocity: PresencePoint;
  started: number;
  previous: number;
  startScale: number;
  scale: number;
  distance: number;
};

type Pointer = {
  graphic: ReturnType<typeof createCursorGraphic>;
  /** A compositor layer: travel and hover move it without repainting the filtered glyph. */
  layer: HTMLDivElement;
  float: HTMLDivElement;
  cue: SVGPathElement;
  bubble: ReturnType<typeof createPresenceBubble>;
  hover?: Animation;
  settle?: Animation;
  exit?: Animation;
  translation: string;
  activity: PresenceActivity;
  executionId?: string;
  activated: boolean;
  /** Where the cursor rests. A flight converges to it. */
  at: PresencePoint;
  flight: Flight | null;
  /** Located geometry: the label sits beside it, the cue outlines it, and a ride keeps clear of it. */
  beside?: PresenceGeometry;
  /**
   * `floating` has never been located and sits at a fallback point. `hidden` lost its target to
   * clipping. `stale` waits for a fresh layout frame after the surface moved.
   */
  visibility: 'floating' | 'visible' | 'hidden' | 'stale';
};

type Destination = { point: PresencePoint; located: boolean; beyond: boolean; geometry?: PresenceGeometry };

const outlineCache = new WeakMap<PresenceGeometry, string>();
function targetOutline(geometry: PresenceGeometry | undefined): string {
  if (!geometry) return '';
  const cached = outlineCache.get(geometry);
  if (cached !== undefined) return cached;
  const path =
    geometry.kind === 'region'
      ? `M${geometry.x},${geometry.y}h${geometry.width}v${geometry.height}h${-geometry.width}Z`
      : geometry.kind === 'path'
        ? geometry.points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ')
        : '';
  if (immutableGeometry(geometry)) outlineCache.set(geometry, path);
  return path;
}

/** Critically damped motion keeps both position and velocity continuous during retargeting. */
function spring(position: number, velocity: number, target: number, dt: number, omega: number) {
  const delta = position - target;
  const impulse = velocity + omega * delta;
  const decay = Math.exp(-omega * dt);
  return { position: target + (delta + impulse * dt) * decay, velocity: (velocity - omega * impulse * dt) * decay };
}

/** A passive overlay. It never dispatches input, moves focus, or scrolls the application. */
export function createBrowserPresenceRenderer(options: BrowserPresenceOptions = {}): PresenceRenderer & {
  invalidateLayout(): void;
} {
  const doc = options.document ?? document;
  const view = doc.defaultView;
  if (!view) throw new Error('Presence renderer requires a live document');
  const duration = options.durationMs ?? 320;
  const hoverDistance = options.hover === false ? 0 : (options.hover?.distance ?? 2.5);
  const hoverPeriod = options.hover === false ? 2600 : (options.hover?.periodMs ?? 2600);
  const bubbleWidth = options.bubble === false ? 260 : (options.bubble?.width ?? 260);
  if (
    ![duration, hoverDistance, hoverPeriod, bubbleWidth].every(Number.isFinite) ||
    duration < 0 ||
    hoverDistance < 0 ||
    hoverPeriod <= 0 ||
    bubbleWidth < 120
  )
    throw new Error('Invalid presence motion or bubble dimensions');
  const icon = options.bubble === false ? false : options.bubble?.icon;
  if (icon !== undefined && icon !== false && !icon.trim()) throw new Error('A bubble icon requires path data');
  const style = cursorStyle(options);
  const travel = travelStyle(options.travel);
  const surface = options.surface ?? browserPresenceSurface;
  const describe = options.describe ?? describePresence;
  const host = doc.createElement('div');
  host.dataset.vacpPresence = '';
  host.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${options.zIndex ?? 2147483646};contain:strict;`;
  const shadow = host.attachShadow({ mode: 'open' });
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'display:block;overflow:hidden;pointer-events:none';
  const status = doc.createElement('div');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  status.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
  shadow.append(svg, status);
  doc.documentElement.append(host);
  const media = view.matchMedia('(prefers-reduced-motion: reduce)');
  const trailKey = Symbol('analytical-trail');
  const keyFor = (activity: PresenceActivity) => (activity.recordId ? trailKey : activity.actor.id);
  const pointers = new Map<string | symbol, Pointer>();
  /** Where a departed actor last rested, so a returning one continues from there. */
  const positions = new Map<string | symbol, PresencePoint>();
  const arrivals = new Map<string, Set<() => void>>();
  let announcement = '';
  let announcementTimer = 0;
  let frame = 0,
    disposed = false;
  const reduced = () => options.motion === 'reduced' || (options.motion !== 'full' && media.matches);
  const still = () => reduced() || doc.hidden;
  const viewport = () => ({ width: view.innerWidth, height: view.innerHeight });
  const arrived = (id: string | undefined) => {
    if (!id) return;
    const pending = arrivals.get(id);
    arrivals.delete(id);
    pending?.forEach((resolve) => resolve());
  };

  /** Quiet thinking motion runs on the compositor; leaving it eases back from the painted offset. */
  const hover = (pointer: Pointer) => {
    const wanted =
      !pointer.exit && pointer.activity.phase === 'thinking' && !pointer.flight && hoverDistance > 0 && !still();
    if (still() || wanted) {
      pointer.settle?.cancel();
      pointer.settle = undefined;
    }
    if (wanted === !!pointer.hover) return;
    if (wanted) {
      pointer.hover = pointer.float.animate(
        [{ transform: `translateY(${-hoverDistance}px)` }, { transform: `translateY(${hoverDistance}px)` }],
        {
          duration: hoverPeriod / 2,
          direction: 'alternate',
          easing: 'ease-in-out',
          iterations: Infinity,
          iterationStart: 0.5,
        },
      );
      return;
    }
    const offset = new view.DOMMatrixReadOnly(view.getComputedStyle(pointer.float).transform).f;
    pointer.hover!.cancel();
    pointer.hover = undefined;
    if (!still() && Math.abs(offset) > 0.01)
      pointer.settle = pointer.float.animate([{ transform: `translateY(${offset}px)` }, { transform: 'none' }], {
        duration: 160,
        easing: 'ease-out',
      });
  };
  /** Feedback plays once per execution, at rest on a located target. */
  const activate = (pointer: Pointer) => {
    const phase = pointer.activity.execution?.phase;
    if (
      pointer.activity.phase === 'reviewing' ||
      !pointer.beside ||
      pointer.activated ||
      pointer.flight ||
      (phase !== 'running' && phase !== 'succeeded')
    )
      return;
    pointer.activated = true;
    pointer.graphic.activate(pointer.at, reduced());
  };

  /** The point a step rests at, or where the pointer keeps waiting when the step has no located target. */
  const destination = (activity: PresenceActivity, key: string | symbol, pointer: Pointer | undefined): Destination => {
    const { target } = activity;
    let point = target?.surface === surface ? presenceAnchor(target.geometry) : null;
    // An off-screen target keeps the bubble at the viewport edge nearest to where the agent acted.
    let beyond = false;
    if (point && target) {
      const bounds = targetBounds(target.geometry, 0);
      if (
        bounds.x + bounds.width <= 0 ||
        bounds.y + bounds.height <= 0 ||
        bounds.x >= view.innerWidth ||
        bounds.y >= view.innerHeight
      )
        beyond = true;
    }
    const located = point !== null && !beyond;
    const size = viewport();
    point ??= pointer?.at ??
      positions.get(key) ??
      options.idlePosition?.(size) ?? {
        x: Math.max(24, size.width - bubbleWidth - 64),
        y: Math.min(92 + pointers.size * 110, size.height * 0.6),
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
  const trackVisibility = (pointer: Pointer, located: boolean, tracking: boolean) => {
    // A stale pointer stays hidden until the layout frame that re-resolved its target arrives.
    if (pointer.visibility === 'stale' && !tracking) return;
    pointer.visibility = located ? 'visible' : pointer.visibility === 'floating' ? 'floating' : 'hidden';
  };
  const land = (pointer: Pointer) => {
    pointer.flight = null;
    arrived(pointer.executionId);
  };
  /** The only writer of `at` and `flight`. */
  const move = (pointer: Pointer, point: PresencePoint, reason: PresenceFrame['reason'], now: number) => {
    const dx = point.x - pointer.at.x;
    const dy = point.y - pointer.at.y;
    if (!dx && !dy) return;
    const from = pointer.flight?.position ?? pointer.at;
    pointer.at = point;
    if (reason === 'layout') {
      // The surface moved under the cursor: shift the whole flight, never restart or cut it.
      if (pointer.flight)
        pointer.flight.position = { x: pointer.flight.position.x + dx, y: pointer.flight.position.y + dy };
      return;
    }
    if (reduced() || duration === 0) return land(pointer);
    pointer.flight = {
      position: from,
      velocity: pointer.flight?.velocity ?? { x: 0, y: 0 },
      started: now,
      previous: now,
      startScale: pointer.flight?.scale ?? 1,
      scale: pointer.flight?.scale ?? 1,
      distance: Math.hypot(point.x - from.x, point.y - from.y),
    };
  };
  const step = (pointer: Pointer, now: number) => {
    const flight = pointer.flight!;
    const dt = Math.max(0, now - flight.previous);
    const progress = Math.min(1, (now - flight.started) / duration);
    const omega = 8 / duration;
    const x = spring(flight.position.x, flight.velocity.x, pointer.at.x, dt, omega);
    const y = spring(flight.position.y, flight.velocity.y, pointer.at.y, dt, omega);
    flight.position = { x: x.position, y: y.position };
    flight.velocity = { x: x.velocity, y: y.velocity };
    flight.previous = now;
    flight.scale = travelScale(progress, flight.distance, flight.startScale, travel);
    const settled =
      Math.hypot(flight.position.x - pointer.at.x, flight.position.y - pointer.at.y) < 0.2 &&
      Math.hypot(x.velocity, y.velocity) < 0.01;
    if (still() || settled) land(pointer);
  };
  /** The only writer of the overlay's geometry: cursor, cue, and label follow the pointer state. */
  const paint = (pointer: Pointer, instant: boolean) => {
    const position = pointer.flight?.position ?? pointer.at;
    const translation = `translate(${position.x}px,${position.y}px)`;
    if (pointer.translation !== translation) {
      pointer.translation = translation;
      pointer.layer.style.transform = translation;
    }
    pointer.graphic.setTravelScale(pointer.flight?.scale ?? 1);
    const shown = pointer.visibility === 'visible' || pointer.visibility === 'floating';
    pointer.graphic.group.style.visibility = shown ? 'visible' : 'hidden';
    pointer.cue.style.visibility = shown ? 'visible' : 'hidden';
    pointer.bubble.element.style.visibility = pointer.visibility === 'stale' ? 'hidden' : 'visible';
    if (pointer.flight) pointer.bubble.ride(position, viewport(), pointer.beside);
    else pointer.bubble.place(pointer.at, viewport(), pointer.beside, instant);
    const { activity } = pointer;
    const outline =
      options.cue?.visible === false || activity.phase === 'thinking' ? '' : targetOutline(pointer.beside);
    updateAttribute(pointer.cue, 'd', outline);
    updateAttribute(pointer.cue, 'data-precision', activity.target?.precision ?? 'surface');
    updateAttribute(pointer.cue, 'stroke-dasharray', activity.target?.precision === 'surface' ? '3 4' : '');
  };
  const tick = (now: number) => {
    frame = 0;
    for (const pointer of pointers.values()) {
      if (pointer.exit || !pointer.flight) continue;
      step(pointer, now);
      paint(pointer, reduced());
      if (!pointer.flight) hover(pointer);
      activate(pointer);
    }
    schedule();
  };
  const schedule = () => {
    const animate = !doc.hidden && [...pointers.values()].some((p) => !p.exit && p.flight);
    if (animate && !frame) frame = view.requestAnimationFrame(tick);
    else if (!animate && frame) {
      view.cancelAnimationFrame(frame);
      frame = 0;
    }
  };
  const makePointer = (activity: PresenceActivity, at: PresencePoint): Pointer => {
    const cue = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    cue.setAttribute('fill', 'none');
    cue.setAttribute('stroke', options.cue?.color ?? '#62666c');
    cue.setAttribute('stroke-width', '1');
    const graphic = createCursorGraphic(svg, options, style);
    graphic.setTravelScale(1);
    const layer = doc.createElement('div');
    layer.style.cssText = 'position:absolute;left:0;top:0;will-change:transform;pointer-events:none';
    const float = doc.createElement('div');
    const glyph = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    glyph.setAttribute('aria-hidden', 'true');
    glyph.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible';
    glyph.append(graphic.group);
    float.append(glyph);
    layer.append(float);
    // Cursors paint above cues and ripples, below every label.
    svg.after(layer);
    const bubble = createPresenceBubble(shadow, bubbleWidth, options.text, icon);
    bubble.element.hidden = options.bubble === false;
    svg.append(cue);
    return {
      graphic,
      layer,
      float,
      cue,
      bubble,
      translation: '',
      activity,
      activated: false,
      at,
      flight: null,
      visibility: 'floating',
    };
  };
  /** Bind a pointer to this frame's activity: execution identity, exit recovery, and the label. */
  const adopt = (pointer: Pointer, activity: PresenceActivity, navigation: PresenceFrame['navigation']) => {
    if (pointer.executionId !== activity.execution?.id) {
      arrived(pointer.executionId);
      pointer.graphic.cancel();
      pointer.activated = false;
    }
    pointer.exit?.cancel();
    pointer.exit = undefined;
    pointer.bubble.element.style.opacity = '1';
    pointer.cue.style.opacity = '1';
    pointer.graphic.group.dataset.vacpPhase = activity.phase;
    pointer.activity = activity;
    pointer.executionId = activity.execution?.id;
    pointer.graphic.setActivity(activity);
    if (activity.phase === 'failed' || activity.phase === 'cancelled') pointer.graphic.cancel();
    pointer.bubble.navigate(navigation);
    return pointer.bubble.update(activity, describe(activity), reduced());
  };
  /** A finished turn hands its pointer to the recorded trail, and the trail hands it back. */
  const adoptTrail = (activities: readonly PresenceActivity[]) => {
    if (activities.length !== 1 || pointers.size !== 1) return;
    const [oldKey, pointer] = pointers.entries().next().value!;
    const nextKey = keyFor(activities[0]!);
    if (oldKey !== nextKey && (pointer.activity.recordId || activities[0]!.recordId)) {
      pointers.delete(oldKey);
      pointers.set(nextKey, pointer);
    }
  };
  const retire = (present: Set<string | symbol>, reviewing: boolean) => {
    for (const [key, pointer] of pointers) {
      if (present.has(key) || pointer.exit) continue;
      positions.delete(key);
      positions.set(key, pointer.flight?.position ?? pointer.at);
      while (positions.size > 32) positions.delete(positions.keys().next().value!);
      arrived(pointer.executionId);
      const remove = () => {
        pointer.hover?.cancel();
        pointer.settle?.cancel();
        pointer.graphic.remove();
        pointer.layer.remove();
        pointer.cue.remove();
        pointer.bubble.remove();
        pointers.delete(key);
      };
      if (still() || reviewing) {
        remove();
        continue;
      }
      pointer.cue.style.opacity = '0';
      pointer.bubble.element.style.pointerEvents = 'none';
      pointer.bubble.element.style.transition = 'opacity 180ms ease-out';
      pointer.bubble.element.style.opacity = '0';
      const exit = pointer.layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
      pointer.exit = exit;
      hover(pointer);
      void exit.finished.then(
        () => {
          if (pointer.exit === exit) remove();
        },
        () => {},
      );
    }
  };
  const announce = (words: string[]) => {
    const next = words.join('\n');
    if (announcement === next) return;
    announcement = next;
    view.clearTimeout(announcementTimer);
    if (options.text) {
      // Streamed text settles first, so the screen reader hears the complete message once.
      announcementTimer = view.setTimeout(() => {
        status.textContent = [...pointers.values()]
          .flatMap((pointer) =>
            pointer.exit ? [] : [`${actorLabel(pointer.activity.actor)}: ${pointer.bubble.readText()}`],
          )
          .join('\n');
      }, 500);
    } else if (status.textContent !== next) status.textContent = next;
  };
  const onMotionChange = () => {
    if (still())
      for (const p of pointers.values()) {
        p.exit?.finish();
        p.graphic.cancel();
        p.bubble.stop();
        p.bubble.update(p.activity, describe(p.activity), reduced());
        p.bubble.element.style.transition = 'none';
        if (p.flight) land(p);
        paint(p, true);
      }
    for (const p of pointers.values()) hover(p);
    schedule();
  };
  media.addEventListener('change', onMotionChange);
  doc.addEventListener('visibilitychange', onMotionChange);
  return {
    invalidateLayout() {
      for (const pointer of pointers.values()) {
        if (pointer.visibility === 'floating') continue;
        pointer.visibility = 'stale';
        pointer.graphic.group.style.visibility = 'hidden';
        pointer.cue.style.visibility = 'hidden';
        pointer.bubble.element.style.visibility = 'hidden';
      }
    },
    render({ activities, reason, navigation }) {
      if (disposed) return;
      const tracking = reason === 'layout';
      const now = view.performance.now();
      adoptTrail(activities);
      const present = new Set<string | symbol>(activities.map(keyFor));
      const words: string[] = [];
      for (const activity of activities) {
        const key = keyFor(activity);
        let pointer = pointers.get(key);
        const dest = destination(activity, key, pointer);
        if (!pointer) {
          pointer = makePointer(activity, dest.point);
          pointers.set(key, pointer);
        }
        words.push(`${actorLabel(activity.actor)}: ${adopt(pointer, activity, navigation)}`);
        trackVisibility(pointer, dest.located, tracking);
        // A read without spatial intent leaves the label beside the last selection.
        if (dest.located) pointer.beside = dest.geometry;
        else if (tracking || dest.beyond) pointer.beside = undefined;
        move(pointer, dest.point, reason, now);
        paint(pointer, tracking || reduced() || duration === 0);
        hover(pointer);
        activate(pointer);
      }
      retire(
        present,
        activities.some((activity) => activity.phase === 'reviewing'),
      );
      announce(words);
      schedule();
    },
    arrive(executionId, signal) {
      if (disposed || signal.aborted || ![...pointers.values()].some((p) => p.executionId === executionId && p.flight))
        return Promise.resolve();
      return new Promise((resolve) => {
        const finish = () => {
          signal.removeEventListener('abort', finish);
          arrivals.get(executionId)?.delete(finish);
          resolve();
        };
        const pending = arrivals.get(executionId) ?? new Set();
        pending.add(finish);
        arrivals.set(executionId, pending);
        signal.addEventListener('abort', finish, { once: true });
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      view.clearTimeout(announcementTimer);
      view.cancelAnimationFrame(frame);
      media.removeEventListener('change', onMotionChange);
      doc.removeEventListener('visibilitychange', onMotionChange);
      for (const id of arrivals.keys()) arrived(id);
      for (const p of pointers.values()) {
        p.exit?.cancel();
        p.hover?.cancel();
        p.graphic.remove();
        p.bubble.remove();
      }
      pointers.clear();
      positions.clear();
      host.remove();
    },
  };
}
