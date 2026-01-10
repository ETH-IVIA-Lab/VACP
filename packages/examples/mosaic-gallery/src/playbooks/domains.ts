import type { VgplotPlotLike } from '@vacp/vgplot';

export type DomainValue = number | Date;

function asDomainValue(value: unknown): DomainValue | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value;
  return null;
}

function domainValueOf(value: DomainValue): number {
  return value instanceof Date ? value.getTime() : value;
}

export function roundNum(value: number): number {
  return Number(value.toFixed(6));
}

export function normalizeDomain(a: unknown, b: unknown): [DomainValue, DomainValue] | null {
  const x = asDomainValue(a);
  const y = asDomainValue(b);
  if (x === null || y === null) return null;
  return domainValueOf(x) <= domainValueOf(y) ? [x, y] : [y, x];
}

export function domainToInterval(
  domain: [DomainValue, DomainValue],
  range: [number, number],
): [DomainValue, DomainValue] {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const t0 = domainValueOf(d0);
  const t1 = domainValueOf(d1);
  const span = t1 - t0;
  const v0 = t0 + span * r0;
  const v1 = t0 + span * r1;
  if (d0 instanceof Date && d1 instanceof Date) return [new Date(v0), new Date(v1)];
  return [roundNum(v0), roundNum(v1)];
}

function readScaleDomain(scale: unknown): unknown[] | null {
  if (!scale) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyScale = scale as any;
  const raw = typeof anyScale.domain === 'function' ? anyScale.domain() : anyScale.domain;
  return Array.isArray(raw) ? raw : null;
}

export function getInterval1dDomain(plot: VgplotPlotLike, interactorId: number): [DomainValue, DomainValue] | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const i = plot.interactors[interactorId] as any;
  const raw = readScaleDomain(i?.scale);
  if (!raw || raw.length < 2) return null;
  return normalizeDomain(raw[0], raw[1]);
}

export function getInterval2dDomains(
  plot: VgplotPlotLike,
  interactorId: number,
): { x: [DomainValue, DomainValue]; y: [DomainValue, DomainValue] } | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const i = plot.interactors[interactorId] as any;
  const rawX = readScaleDomain(i?.xscale);
  const rawY = readScaleDomain(i?.yscale);
  if (!rawX || rawX.length < 2 || !rawY || rawY.length < 2) return null;
  const x = normalizeDomain(rawX[0], rawX[1]);
  const y = normalizeDomain(rawY[0], rawY[1]);
  if (!x || !y) return null;
  return { x, y };
}

export function getPanZoom2dDomains(
  plot: VgplotPlotLike,
  interactorId: number,
): { x: [DomainValue, DomainValue] | null; y: [DomainValue, DomainValue] | null } | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const i = plot.interactors[interactorId] as any;
  const xraw = Array.isArray(i?.xdomain) ? i.xdomain : readScaleDomain(i?.xscale);
  const yraw = Array.isArray(i?.ydomain) ? i.ydomain : readScaleDomain(i?.yscale);
  const x = xraw && xraw.length >= 2 ? normalizeDomain(xraw[0], xraw[1]) : null;
  const y = yraw && yraw.length >= 2 ? normalizeDomain(yraw[0], yraw[1]) : null;
  if (!x && !y) return null;
  return { x, y };
}
