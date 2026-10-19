import { formatVacpWallClock, type VacpClock } from '@ethivia/vacp-protocol';

import type { VegaLiteFieldTypes } from './dataflow';
import { vegaInstant } from './temporal';

/** A value as a continuous scale coerces it with `+value`, as decimal text, or null when that names no number. */
function number(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const coerced = typeof value === 'number' ? value : +(value as string);
  return Number.isFinite(coerced) ? String(coerced) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeDuckDbValue(value: unknown) {
  if (value === undefined || value === null) return null;

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;

  if (typeof value === 'bigint') return value.toString();

  if (Array.isArray(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  if (typeof value === 'object') {
    // DuckDB cannot infer types from an empty JSON object (`{}`) and errors
    // with "STRUCT with no fields". Treat those as null.
    if (Object.keys(value as Record<string, unknown>).length === 0) return null;

    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }

  return typeof value === 'symbol' || typeof value === 'function' ? String(value) : null;
}

/** Rows ready for DuckDB, with the columns they hold and the columns the loader types. */
export type TableRows = {
  rows: Record<string, unknown>[];
  columns: ReadonlySet<string>;
  /** Columns of wall-clock text, with the clock of their instants, which load as TIMESTAMP. */
  timestamps: ReadonlyMap<string, VacpClock>;
  /** Columns of decimal text, which load as DOUBLE. */
  numbers: ReadonlySet<string>;
};

/**
 * Rows ready for DuckDB. A column holds instants when the source's dataflow says so or its values
 * are Dates. Its instants load as wall-clock text on the axis's clock, so SQL reads the dates the
 * chart shows. A column a continuous scale reads loads as numbers, as Vega coerces them. A value in
 * either kind of column that names no instant or number loads as null.
 */
export function tableRows(source: readonly unknown[], fields: VegaLiteFieldTypes): TableRows {
  const { temporal, numeric } = fields;
  const columns = new Set<string>();
  const timestamps = new Map<string, VacpClock>();
  const numbers = new Set<string>();
  // Time units repeat a few hundred instants across every row, so each is formatted once per load.
  const texts = { local: new Map<number, string>(), utc: new Map<number, string>() };
  const wallClock = (time: number, clock: VacpClock) => {
    let text = texts[clock].get(time);
    if (text === undefined) texts[clock].set(time, (text = formatVacpWallClock(time, clock)));
    return text;
  };
  const rows: Record<string, unknown>[] = [];
  for (const row of source) {
    if (!isRecord(row)) continue;
    const keys = Object.keys(row);
    if (!keys.length) continue;
    const loaded: Record<string, unknown> = {};
    for (const key of keys) {
      columns.add(key);
      const value = row[key];
      const clock = temporal.get(key) ?? (value instanceof Date ? 'local' : undefined);
      if (clock) {
        timestamps.set(key, clock);
        const instant = vegaInstant(value);
        loaded[key] = instant === null ? null : wallClock(instant, clock);
      } else if (numeric.has(key)) {
        numbers.add(key);
        loaded[key] = number(value);
      } else loaded[key] = sanitizeDuckDbValue(value);
    }
    rows.push(loaded);
  }
  return { rows, columns, timestamps, numbers };
}
