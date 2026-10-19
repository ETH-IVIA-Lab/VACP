import type { PresenceGeometry, PresencePoint } from '@ethivia/vacp-presence-core';

type Rect = PresencePoint & { width: number; height: number };
type Side = 'right' | 'left' | 'above' | 'below';
/** Where the label sits, and the target and cursor it was placed for. */
export type BubblePlacement = Rect & { side: Side; target: Rect; anchor: PresencePoint };

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

/**
 * Place the label beside its target, as close to the cursor as the free space allows. Beside the
 * target, the label's top follows the cursor. Above or below it, the edge nearest the target stays
 * put, so words that arrive and grow the label push it away from the cursor instead of moving it.
 * While the target stays the same, including through layout shifts, the label keeps its side unless
 * that side no longer fits. A new target starts from the side nearest its cursor.
 */
export function placeBubble(
  target: Rect,
  anchor: PresencePoint,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  previous?: BubblePlacement,
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
  for (const candidate of candidates) {
    candidate.x = Math.max(12, Math.min(viewport.width - size.width - 12, candidate.x));
    candidate.y = Math.max(12, Math.min(viewport.height - size.height - 12, candidate.y));
  }
  const kept = previous && sameTarget(previous, target, anchor) ? previous.side : undefined;
  // Growing upward moves the words the person is reading, so above is the last resort.
  const bias = { right: 0, below: 30, left: 40, above: 90 };
  const score = (rect: BubblePlacement) =>
    overlap(rect, target) * 10000 +
    Math.hypot(
      Math.max(rect.x - cx, 0, cx - rect.x - rect.width),
      Math.max(rect.y - cy, 0, cy - rect.y - rect.height),
    ) +
    (kept ? (rect.side === kept ? 0 : 400) : bias[rect.side]);
  return candidates.reduce((best, candidate) => (score(candidate) < score(best) ? candidate : best));
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
