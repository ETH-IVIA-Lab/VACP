import type { PresenceGeometry, PresencePoint } from '@ethivia/vacp-presence';

type Size = { width: number; height: number };
type Rect = PresencePoint & Size;
type Side = 'right' | 'left' | 'above' | 'below';
/** Where the label sits, and the target and cursor it was placed for. */
export type BubblePlacement = Rect & { side: Side; target: Rect; anchor: PresencePoint };
/**
 * Where the label is painted as it sets out toward a new placement, and where its cursor sets out
 * from when the label rides along.
 */
export type Departure = { label: PresencePoint; from?: PresencePoint };

export function immutableGeometry(geometry: PresenceGeometry): boolean {
  return (
    Object.isFrozen(geometry) &&
    (geometry.kind === 'region' ||
      (geometry.kind === 'point'
        ? Object.isFrozen(geometry.point)
        : Object.isFrozen(geometry.points) && geometry.points.every((point) => Object.isFrozen(point))))
  );
}

const boundsCache = new WeakMap<PresenceGeometry, Map<number, Rect>>();

export function targetBounds(geometry: PresenceGeometry, padding = 12): Rect {
  const cached = boundsCache.get(geometry)?.get(padding);
  if (cached) return cached;
  const bounds = measureTarget(geometry, padding);
  if (immutableGeometry(geometry)) {
    const values = boundsCache.get(geometry) ?? new Map<number, Rect>();
    values.set(padding, Object.freeze(bounds));
    boundsCache.set(geometry, values);
  }
  return bounds;
}

function measureTarget(geometry: PresenceGeometry, padding: number): Rect {
  if (geometry.kind === 'region') return geometry;
  const points = geometry.kind === 'point' ? [geometry.point] : geometry.points;
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const point of points) {
    x = Math.min(x, point.x);
    y = Math.min(y, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return { x: x - padding, y: y - padding, width: right - x + padding * 2, height: bottom - y + padding * 2 };
}

function overlap(a: Rect, b: Rect): number {
  return (
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  );
}

/** Keep a label of `size` 12 px inside the viewport. */
function clamp(point: PresencePoint, size: Size, viewport: Size): PresencePoint {
  return {
    x: Math.max(12, Math.min(viewport.width - size.width - 12, point.x)),
    y: Math.max(12, Math.min(viewport.height - size.height - 12, point.y)),
  };
}

/**
 * Where the label is painted while its cursor travels from `departure` to `rest.anchor` and is at
 * `cursor`. The label keeps its offset from the cursor as the flight begins and eases it toward its
 * offset at `rest` as the cursor arrives, inside the viewport like every placement.
 */
export function ride(
  departure: Required<Departure>,
  cursor: PresencePoint,
  rest: BubblePlacement,
  viewport: Size,
): PresencePoint {
  const { from, label } = departure;
  const { anchor } = rest;
  const distance = Math.hypot(anchor.x - from.x, anchor.y - from.y);
  const remaining = Math.hypot(anchor.x - cursor.x, anchor.y - cursor.y);
  const progress = distance > 0 ? Math.max(0, Math.min(1, 1 - remaining / distance)) : 1;
  const eased = 1 - (1 - progress) ** 3;
  const offset = (axis: 'x' | 'y') =>
    label[axis] - from[axis] + (rest[axis] - anchor[axis] - (label[axis] - from[axis])) * eased;
  return clamp({ x: cursor.x + offset('x'), y: cursor.y + offset('y') }, rest, viewport);
}

/** The label rests for seconds and passes over its target in a fraction of one. */
const restWeight = 3;

/**
 * How much of `target` the label covers on its way from `departure` to `rest`, as `placeBubble` ranks
 * it. A label whose cursor travels rides along. Otherwise it moves in a straight line, as the settle
 * animation eases between its two keyframes. Without a departure, the label appears at rest.
 */
function covered(target: Rect, rest: BubblePlacement, viewport: Size, departure: Departure | undefined): number {
  const resting = overlap(rest, target) * restWeight;
  if (!departure) return resting;
  const { from, label } = departure;
  const { anchor } = rest;
  const cover = (t: number) => {
    // A flight that starts from standstill carries the cursor along the straight line to its anchor.
    const point = from
      ? ride(
          { from, label },
          { x: from.x + (anchor.x - from.x) * t, y: from.y + (anchor.y - from.y) * t },
          rest,
          viewport,
        )
      : { x: label.x + (rest.x - label.x) * t, y: label.y + (rest.y - label.y) * t };
    return overlap({ ...point, width: rest.width, height: rest.height }, target);
  };
  // Every side paints the same first frame, so only what the label covers beyond it tells sides apart.
  const start = cover(0);
  let most = start;
  for (let step = 1; step < 100; step++) most = Math.max(most, cover(step / 100));
  return Math.max(most - start, resting);
}

/**
 * Place the label beside its target, as close to the cursor as the free space allows. Beside the
 * target, the label's top follows the cursor. Above or below it, the edge nearest the target stays
 * put, so words that arrive and grow the label push it away from the cursor instead of moving it.
 *
 * Sides rank in three tiers:
 *
 * 1. How much of the target the label covers on its way there from `departure`, in whole pixels:
 *    the most it covers while moving beyond what it covers where it sets out, or `restWeight` times
 *    what it covers at rest, whichever is larger. A clear path beats every path that touches the
 *    target. A thin strip at rest beats a sweep across the target, and a sweep that ends clear beats
 *    resting on much of it.
 * 2. While the target stays the same, including through layout shifts, the side the label is on.
 * 3. The distance from the cursor plus a bias per side, so a new target starts from the side nearest
 *    its cursor.
 */
export function placeBubble(
  target: Rect,
  anchor: PresencePoint,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  previous?: BubblePlacement,
  departure?: Departure,
): BubblePlacement {
  const gap = 20;
  const cx = anchor.x;
  const cy = anchor.y;
  const base = { ...size, target, anchor };
  const candidates: BubblePlacement[] = [
    { ...base, side: 'right', x: target.x + target.width + gap, y: cy - 16 },
    { ...base, side: 'left', x: target.x - size.width - gap, y: cy - 16 },
    { ...base, side: 'below', x: cx - size.width / 2, y: target.y + target.height + gap },
    { ...base, side: 'above', x: cx - size.width / 2, y: target.y - size.height - gap },
  ];
  for (const candidate of candidates) Object.assign(candidate, clamp(candidate, size, viewport));
  const kept = previous && sameTarget(previous, target, anchor) ? previous.side : undefined;
  // Growing upward moves the words the person is reading, so above is the last resort.
  const bias = { right: 0, below: 30, left: 40, above: 90 };
  const ranked = candidates.map((rect) => ({
    rect,
    // Coverage compares in whole pixels, so rounding error never outranks the kept side or the bias.
    covered: Math.round(covered(target, rect, viewport, departure)),
    switched: rect.side === kept ? 0 : 1,
    cost:
      Math.hypot(
        Math.max(rect.x - cx, 0, cx - rect.x - rect.width),
        Math.max(rect.y - cy, 0, cy - rect.y - rect.height),
      ) + bias[rect.side],
  }));
  ranked.sort((a, b) => a.covered - b.covered || a.switched - b.switched || a.cost - b.cost);
  return ranked[0]!.rect;
}

/** A layout shift moves the target and its cursor together, so size and cursor offset identify it. */
function sameTarget(previous: BubblePlacement, target: Rect, anchor: PresencePoint): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 1;
  return (
    near(previous.target.width, target.width) &&
    near(previous.target.height, target.height) &&
    near(previous.anchor.x - previous.target.x, anchor.x - target.x) &&
    near(previous.anchor.y - previous.target.y, anchor.y - target.y)
  );
}
