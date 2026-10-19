import { formatVacpWallClock, parseVacpInstant, type VacpClock } from '@ethivia/vacp-protocol';

/**
 * The instant a value Vega holds names: a Date, epoch milliseconds, or date text as Vega's own
 * `toDate` reads it. Other values name no instant.
 */
export function vegaInstant(value: unknown): number | null {
  let time = Number.NaN;
  if (value instanceof Date) time = value.getTime();
  else if (typeof value === 'number') time = value;
  else if (typeof value === 'string' && value.trim()) time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/**
 * The instant a caller wrote for a temporal field: ISO text on the field's clock, a Date, or epoch
 * milliseconds. Throws for anything else, so a request never quietly reads as no instant.
 */
export function inputInstant(value: unknown, clock: VacpClock): number {
  if (typeof value === 'string') return parseVacpInstant(value, clock);
  const time = value instanceof Date ? value.getTime() : value;
  if (typeof time === 'number' && Number.isFinite(time)) return time;
  throw new RangeError(`Expected an ISO date or a timestamp, received ${JSON.stringify(value)}`);
}

/** An instant in an axis's terms: its date, with the time of day when it is not midnight. */
export function formatAxisInstant(time: number, clock: VacpClock): string {
  const wall = formatVacpWallClock(time, clock);
  return wall.endsWith('T00:00:00.000') ? wall.slice(0, 10) : wall.slice(0, 16).replace('T', ' ');
}
