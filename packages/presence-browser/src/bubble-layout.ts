import type { PresenceGeometry, PresencePoint } from '@vacp/presence-core';

type Rect = PresencePoint & { width: number; height: number };
type Side = 'right' | 'left' | 'above' | 'below';
export type BubblePlacement = Rect & { side: Side };

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
 * Beside the agent cursor, outside the region it acts on. Candidates align with the cursor so the label
 * follows it from step to step; a side is retained until another is materially closer.
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
  const candidates: BubblePlacement[] = [
    { ...size, side: 'right', x: target.x + target.width + gap, y: cy - size.height / 2 },
    { ...size, side: 'left', x: target.x - size.width - gap, y: cy - size.height / 2 },
    { ...size, side: 'above', x: cx - size.width / 2, y: target.y - size.height - gap },
    { ...size, side: 'below', x: cx - size.width / 2, y: target.y + target.height + gap },
  ];
  for (const candidate of candidates) {
    candidate.x = Math.max(12, Math.min(viewport.width - size.width - 12, candidate.x));
    candidate.y = Math.max(12, Math.min(viewport.height - size.height - 12, candidate.y));
  }
  const score = (rect: BubblePlacement) =>
    overlap(rect, target) * 10000 +
    Math.hypot(rect.x + rect.width / 2 - cx, rect.y + rect.height / 2 - cy) +
    (rect.side === (previous?.side ?? 'right') ? 0 : 80);
  return candidates.reduce((best, candidate) => (score(candidate) < score(best) ? candidate : best));
}

/** The smallest axis-aligned shift that clears `rect` of `region` while staying inside `within`. */
export function pushOut(rect: Rect, region: Rect, within: Rect, gap = 8): Rect {
  const overlapX = Math.min(rect.x + rect.width, region.x + region.width) - Math.max(rect.x, region.x);
  const overlapY = Math.min(rect.y + rect.height, region.y + region.height) - Math.max(rect.y, region.y);
  if (overlapX <= 0 || overlapY <= 0) return rect;
  const shifted = [
    { ...rect, y: region.y - gap - rect.height },
    { ...rect, y: region.y + region.height + gap },
    { ...rect, x: region.x - gap - rect.width },
    { ...rect, x: region.x + region.width + gap },
  ];
  const fits = (candidate: Rect) =>
    candidate.x >= within.x &&
    candidate.y >= within.y &&
    candidate.x + candidate.width <= within.x + within.width &&
    candidate.y + candidate.height <= within.y + within.height;
  const distance = (candidate: Rect) => Math.hypot(candidate.x - rect.x, candidate.y - rect.y);
  const options = shifted.filter(fits);
  return (options.length ? options : shifted).reduce((best, next) => (distance(next) < distance(best) ? next : best));
}

/** A fade at the destination avoids sweeping the label across the selection. */
export function crossesTarget(from: Rect, to: Rect, target: Rect): boolean {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return (
    overlap(
      {
        x,
        y,
        width: Math.max(from.x + from.width, to.x + to.width) - x,
        height: Math.max(from.y + from.height, to.y + to.height) - y,
      },
      target,
    ) > 0
  );
}
