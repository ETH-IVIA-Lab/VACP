/** The clock a temporal axis reads: the browser's local time, or UTC. */
export type VacpClock = 'local' | 'utc';

const isoPattern =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?)?(?:(Z)|([+-])(\d{2}):?(\d{2}))?$/;

/**
 * The instant ISO 8601 text names. A date alone means its midnight and a time without an offset is
 * wall-clock time, both on `clock`. Text ending in `Z` or an offset names its instant exactly. Other
 * text, and dates the calendar lacks such as `2012-02-30`, throw a `RangeError`.
 */
export function parseVacpInstant(text: string, clock: VacpClock): number {
  const match = isoPattern.exec(text.trim());
  if (!match) throw new RangeError(`Expected an ISO date or date-time, received ${JSON.stringify(text)}`);
  const [
    ,
    year,
    month,
    day,
    hour = '0',
    minute = '0',
    second = '0',
    fraction = '0',
    zulu,
    sign,
    offsetHour,
    offsetMinute,
  ] = match;
  const parts = [
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(fraction.padEnd(3, '0')),
  ] as const;
  const wall = new Date(Date.UTC(...parts));
  wall.setUTCFullYear(parts[0]);
  const read = [wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), wall.getUTCHours(), wall.getUTCMinutes()];
  if (read.some((value, index) => value !== parts[index]) || parts[5] > 59)
    throw new RangeError(`${JSON.stringify(text)} is not a date on the calendar`);
  if (zulu) return wall.getTime();
  if (sign) {
    const offset = (Number(offsetHour) * 60 + Number(offsetMinute)) * (sign === '-' ? -1 : 1);
    return wall.getTime() - offset * 60_000;
  }
  if (clock === 'utc') return wall.getTime();
  const local = new Date(...parts);
  local.setFullYear(parts[0]);
  return local.getTime();
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** An instant as wall-clock text on `clock`: `YYYY-MM-DDTHH:mm:ss.sss`, without an offset. */
export function formatVacpWallClock(time: number, clock: VacpClock): string {
  const date = new Date(time);
  const utc = clock === 'utc';
  const [year, month, day] = utc
    ? [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()]
    : [date.getFullYear(), date.getMonth(), date.getDate()];
  const [hours, minutes, seconds] = utc
    ? [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
    : [date.getHours(), date.getMinutes(), date.getSeconds()];
  return `${pad(year, 4)}-${pad(month + 1)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(date.getUTCMilliseconds(), 3)}`;
}
