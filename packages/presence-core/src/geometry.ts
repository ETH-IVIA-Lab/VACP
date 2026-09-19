import type { PresenceGeometry, PresencePoint, PresenceTarget } from './types.js';

export function presenceAnchor(geometry: PresenceGeometry): PresencePoint | null {
  switch (geometry.kind) {
    case 'point':
      return geometry.point;
    case 'region':
      return { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 };
    case 'path':
      return geometry.points.at(-1) ?? null;
  }
}

/** Reject invalid geometry before it reaches any renderer. */
export function validPresenceTarget(target: PresenceTarget): boolean {
  if (!target.surface) return false;
  const g = target.geometry;
  if (g.kind === 'region') return [g.x, g.y, g.width, g.height].every(Number.isFinite) && g.width >= 0 && g.height >= 0;
  const points = g.kind === 'point' ? [g.point] : g.points;
  return points.length > 0 && points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}
