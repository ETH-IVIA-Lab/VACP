import { travelScale, travelStyle, type CursorTravel } from './motion';
import { createCursorGraphic, cursorStyle, type CursorAppearance } from './cursor';
import { presenceAnchor, type PresenceActivity, type PresencePoint, type PresenceRenderer } from '@vacp/presence-core';
import { browserPresenceSurface } from './targets';
import { updateAttribute } from './svg';

export type BrowserPresenceOptions = CursorAppearance & {
  document?: Document;
  surface?: string;
  motion?: 'system' | 'reduced' | 'full';
  durationMs?: number;
  /** Enlarge the cursor during longer moves. Disable independently of position interpolation. */
  travel?: CursorTravel;
  cue?: { color?: string; visible?: boolean };
  labels?: boolean;
  zIndex?: number;
  /** Replace all activity wording, including nonspatial and failed operations. */
  describe?: (activity: PresenceActivity) => string;
};

type Pointer = {
  graphic: ReturnType<typeof createCursorGraphic>;
  group: SVGGElement;
  activated: boolean;
  phase: PresenceActivity['execution']['phase'];
  cue: SVGPathElement;
  label: SVGTextElement;
  position: PresencePoint | null;
  target: PresencePoint | null;
  start: PresencePoint | null;
  started: number;
  scale: number;
  startScale: number;
  distance: number;
  executionId: string;
};

function description(activity: PresenceActivity): string {
  const { execution, freshness } = activity;
  const title = execution.title ?? execution.name;
  const actor = execution.actor.label ?? 'Agent';
  if (execution.phase === 'failed') return `${actor}: ${title} failed`;
  if (execution.phase === 'cancelled') return `${actor}: ${title} cancelled`;
  if (execution.phase === 'succeeded')
    return `${actor}: ${title} applied${freshness === 'updating' ? ', outputs updating' : freshness === 'current' ? ', outputs current' : freshness === 'error' ? ', output error' : ''}`;
  return `${actor}: ${title}`;
}

/** A passive overlay. It never dispatches input, moves focus, or scrolls the application. */
export function createBrowserPresenceRenderer(options: BrowserPresenceOptions = {}): PresenceRenderer {
  const doc = options.document ?? document;
  const view = doc.defaultView;
  if (!view) throw new Error('Presence renderer requires a live document');
  const duration = options.durationMs ?? 220;
  const style = cursorStyle(options);
  const travel = travelStyle(options.travel);
  const size = style.size;
  if (!Number.isFinite(duration) || duration < 0) throw new Error('Invalid cursor duration or size');
  const host = doc.createElement('div');
  host.dataset.vacpPresence = '';
  host.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${options.zIndex ?? 2147483646};contain:strict;`;
  const shadow = host.attachShadow({ mode: 'open' });
  const ns = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(ns, 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'display:block;overflow:hidden;pointer-events:none';
  const status = doc.createElement('div');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  status.style.cssText =
    'position:absolute;left:16px;bottom:16px;max-width:min(460px,calc(100vw - 32px));font:12px/1.5 system-ui;color:#363636;background:rgba(255,255,255,.94);padding:4px 8px;border-radius:3px;white-space:pre-line';
  status.hidden = true;
  shadow.append(svg, status);
  doc.documentElement.append(host);
  const media = view.matchMedia('(prefers-reduced-motion: reduce)');
  const pointers = new Map<string, Pointer>();
  const positions = new Map<string, PresencePoint>();
  const arrivals = new Map<string, Set<() => void>>();
  let frame = 0,
    disposed = false;
  const reduced = () => options.motion === 'reduced' || (options.motion !== 'full' && media.matches);
  const arrived = (id: string) => {
    const pending = arrivals.get(id);
    arrivals.delete(id);
    pending?.forEach((resolve) => resolve());
  };
  const place = (pointer: Pointer) => {
    if (pointer.position)
      updateAttribute(pointer.group, 'transform', `translate(${pointer.position.x} ${pointer.position.y})`);
  };
  const activate = (pointer: Pointer) => {
    if (
      pointer.activated ||
      pointer.start ||
      !pointer.position ||
      (pointer.phase !== 'running' && pointer.phase !== 'succeeded')
    )
      return;
    pointer.activated = true;
    pointer.graphic.activate(pointer.position, reduced());
  };
  const tick = (now: number) => {
    frame = 0;
    let moving = false;
    for (const pointer of pointers.values()) {
      if (!pointer.target || !pointer.start) continue;
      const progress = reduced() || duration === 0 ? 1 : Math.min(1, (now - pointer.started) / duration);
      const eased = 1 - (1 - progress) ** 3;
      pointer.position = {
        x: pointer.start.x + (pointer.target.x - pointer.start.x) * eased,
        y: pointer.start.y + (pointer.target.y - pointer.start.y) * eased,
      };
      pointer.scale = progress === 1 ? 1 : travelScale(progress, pointer.distance, pointer.startScale, travel);
      pointer.graphic.setTravelScale(pointer.scale);
      place(pointer);
      if (progress === 1) {
        pointer.start = null;
        arrived(pointer.executionId);
        activate(pointer);
      } else moving = true;
    }
    if (moving) frame = view.requestAnimationFrame(tick);
  };
  const schedule = () => {
    for (const pointer of pointers.values())
      if (pointer.start) {
        if (!frame) frame = view.requestAnimationFrame(tick);
        return;
      }
    if (frame) view.cancelAnimationFrame(frame);
    frame = 0;
  };
  const makePointer = (): Pointer => {
    const cue = doc.createElementNS(ns, 'path');
    cue.setAttribute('fill', 'none');
    cue.setAttribute('stroke', options.cue?.color ?? '#62666c');
    cue.setAttribute('stroke-width', '1');
    const graphic = createCursorGraphic(svg, options, style);
    const group = graphic.group;
    const label = doc.createElementNS(ns, 'text');
    label.setAttribute('x', String(size + 5));
    label.setAttribute('y', String(size));
    label.setAttribute('fill', '#333');
    label.style.font = '12px system-ui';
    group.append(label);
    svg.append(cue, group);
    return {
      graphic,
      group,
      cue,
      label,
      activated: false,
      phase: 'prepared',
      position: null,
      target: null,
      start: null,
      started: 0,
      executionId: '',
      scale: 1,
      startScale: 1,
      distance: 0,
    };
  };
  const onMotionChange = () => {
    if (reduced()) for (const pointer of pointers.values()) pointer.graphic.cancel();
    schedule();
  };
  media.addEventListener('change', onMotionChange);
  return {
    render(activities) {
      if (disposed) return;
      const present = new Set(activities.map((activity) => activity.execution.actor.id));
      const words: string[] = [];
      for (const activity of activities) {
        const { execution, target } = activity;
        const text = (options.describe ?? description)(activity);
        words.push(text);
        const point =
          target?.surface === (options.surface ?? browserPresenceSurface) ? presenceAnchor(target.geometry) : null;
        let pointer = pointers.get(execution.actor.id);
        if (!point || point.x < 0 || point.y < 0 || point.x > view.innerWidth || point.y > view.innerHeight) {
          if (pointer) {
            pointer.group.style.display = 'none';
            pointer.cue.style.display = 'none';
            pointer.start = null;
            pointer.target = null;
            pointer.scale = 1;
            pointer.graphic.setTravelScale(1);
            pointer.graphic.cancel();
            arrived(pointer.executionId);
          }
          continue;
        }
        if (!pointer) {
          pointer = makePointer();
          pointer.position = positions.get(execution.actor.id) ?? null;
          place(pointer);
          pointers.set(execution.actor.id, pointer);
        }
        if (pointer.executionId !== execution.id) {
          arrived(pointer.executionId);
          pointer.graphic.cancel();
          pointer.activated = false;
        }
        pointer.graphic.setActivity(activity);
        pointer.group.style.display = '';
        pointer.cue.style.display = '';
        pointer.phase = execution.phase;
        if (execution.phase === 'failed' || execution.phase === 'cancelled') pointer.graphic.cancel();
        pointer.executionId = execution.id;
        const label = options.labels ? (execution.actor.label ?? 'Agent') : '';
        if (pointer.label.textContent !== label) pointer.label.textContent = label;
        if (!pointer.position || reduced()) {
          pointer.position = point;
          pointer.start = null;
          pointer.scale = 1;
          pointer.graphic.setTravelScale(1);
          place(pointer);
          arrived(execution.id);
        } else if (pointer.target?.x !== point.x || pointer.target?.y !== point.y) {
          pointer.start = pointer.position;
          pointer.startScale = pointer.scale;
          pointer.distance = Math.hypot(point.x - pointer.position.x, point.y - pointer.position.y);
          pointer.started = view.performance.now();
        }
        pointer.target = point;
        activate(pointer);
        const g = target!.geometry;
        const path =
          g.kind === 'region'
            ? `M${g.x},${g.y}h${g.width}v${g.height}h${-g.width}Z`
            : g.kind === 'path'
              ? g.points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')
              : '';
        updateAttribute(pointer.cue, 'd', options.cue?.visible === false ? '' : path);
        updateAttribute(pointer.cue, 'data-precision', target!.precision);
        updateAttribute(pointer.cue, 'stroke-dasharray', target!.precision === 'surface' ? '3 4' : '');
      }
      for (const [actorId, pointer] of pointers)
        if (!present.has(actorId)) {
          if (pointer.position) {
            positions.delete(actorId);
            positions.set(actorId, pointer.position);
            while (positions.size > 32) positions.delete(positions.keys().next().value!);
          }
          pointer.graphic.remove();
          pointer.cue.remove();
          pointers.delete(actorId);
          arrived(pointer.executionId);
        }
      const next = words.join('\n');
      if (status.textContent !== next) status.textContent = next;
      status.hidden = words.length === 0;
      schedule();
    },
    arrive(executionId, signal) {
      if (
        disposed ||
        signal.aborted ||
        ![...pointers.values()].some((pointer) => pointer.executionId === executionId && pointer.start)
      )
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
      view.cancelAnimationFrame(frame);
      media.removeEventListener('change', onMotionChange);
      for (const id of arrivals.keys()) arrived(id);
      for (const pointer of pointers.values()) pointer.graphic.remove();
      pointers.clear();
      positions.clear();
      host.remove();
    },
  };
}
