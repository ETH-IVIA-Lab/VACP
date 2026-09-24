export type CursorTravel = false | { scale?: number; minDistance?: number; fullDistance?: number };
export type TravelStyle = { scale: number; minDistance: number; fullDistance: number };

export function travelStyle(options: CursorTravel | undefined): TravelStyle {
  const style = {
    scale: options === false ? 1 : (options?.scale ?? 1.6),
    minDistance: options === false ? 80 : (options?.minDistance ?? 80),
    fullDistance: options === false ? 500 : (options?.fullDistance ?? 500),
  };
  if (
    !Object.values(style).every(Number.isFinite) ||
    style.scale < 1 ||
    style.minDistance < 0 ||
    style.fullDistance <= style.minDistance
  )
    throw new Error('Invalid cursor travel scale or distances');
  return style;
}

/** Smooth at both ends and bounded, including when a new target interrupts a flight. */
export function travelScale(progress: number, distance: number, start: number, style: TravelStyle) {
  const strength = Math.max(0, Math.min(1, (distance - style.minDistance) / (style.fullDistance - style.minDistance)));
  const base = 1 + (start - 1) * (1 - progress) ** 3;
  const bloom = Math.sin(Math.PI * progress) ** 2;
  return Math.min(style.scale, base + (style.scale - base) * strength * bloom);
}

/** Critically damped motion keeps both position and velocity continuous during retargeting. */
export function spring(position: number, velocity: number, target: number, dt: number, omega: number) {
  const delta = position - target;
  const impulse = velocity + omega * delta;
  const decay = Math.exp(-omega * dt);
  return { position: target + (delta + impulse * dt) * decay, velocity: (velocity - omega * impulse * dt) * decay };
}
